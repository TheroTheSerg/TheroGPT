import os
import json
import uuid
import traceback
import eventlet # Import eventlet
eventlet.monkey_patch() # Patch standard libraries for async compatibility

from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_cors import CORS
import ollama

app = Flask(__name__)
CORS(app)
# Initialize SocketIO with async_mode='eventlet'
socketio = SocketIO(app, async_mode='eventlet')

# --- Configuration ---
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")
CHAT_SESSIONS_DIR = 'chat_sessions'

# --- Helper Functions ---

def get_chat_filepath(user_id, chat_id):
    user_dir = os.path.join(CHAT_SESSIONS_DIR, user_id)
    return os.path.join(user_dir, f"{chat_id}.json")

def load_chat_history(user_id, chat_id):
    filepath = get_chat_filepath(user_id, chat_id)
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            return json.loads(content) if content else []
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error loading chat history for {chat_id}: {e}")
        return []

def save_chat_history(user_id, chat_id, history):
    filepath = get_chat_filepath(user_id, chat_id)
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=4, ensure_ascii=False)
    except IOError as e:
        print(f"Error saving chat history for {chat_id}: {e}")

# --- Socket.IO Event Handlers ---

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('get_chats')
def handle_get_chats(data):
    user_id = data.get('userId')
    if not user_id: return

    user_dir = os.path.join(CHAT_SESSIONS_DIR, user_id)
    if not os.path.exists(user_dir):
        socketio.emit('chat_list', {'chats': []}, to=request.sid)
        return

    chat_files = [f for f in os.listdir(user_dir) if f.endswith('.json')]
    chats = []
    # Sort by modification time to get the most recent chats first
    for filename in sorted(chat_files, key=lambda f: os.path.getmtime(os.path.join(user_dir, f)), reverse=True):
        chat_id = os.path.splitext(filename)[0]
        history = load_chat_history(user_id, chat_id)
        title = next((msg['content'] for msg in history if msg['role'] == 'user'), 'New Chat')
        chats.append({'id': chat_id, 'title': title[:50]})
    socketio.emit('chat_list', {'chats': chats}, to=request.sid)

@socketio.on('get_history')
def handle_get_history(data):
    user_id, chat_id = data.get('userId'), data.get('chatId')
    history = load_chat_history(user_id, chat_id)
    socketio.emit('chat_history', {'chatId': chat_id, 'history': history}, to=request.sid)

@socketio.on('new_chat')
def handle_new_chat(data):
    user_id = data.get('userId')
    if not user_id: return
    chat_id = str(uuid.uuid4())
    save_chat_history(user_id, chat_id, [])
    socketio.emit('chat_created', {'id': chat_id, 'title': 'New Chat'}, to=request.sid)

@socketio.on('delete_chat')
def handle_delete_chat(data):
    user_id, chat_id = data.get('userId'), data.get('chatId')
    filepath = get_chat_filepath(user_id, chat_id)
    if os.path.exists(filepath):
        os.remove(filepath)
    socketio.emit('chat_deleted', {'chatId': chat_id}, to=request.sid)

@socketio.on('message')
def handle_message(data):
    user_id, chat_id, user_message = data.get('userId'), data.get('chatId'), data.get('message')
    history = load_chat_history(user_id, chat_id)
    is_first_user_message = not any(msg['role'] == 'user' for msg in history)

    history.append({'role': 'user', 'content': user_message})
    save_chat_history(user_id, chat_id, history)

    if is_first_user_message:
        socketio.emit('chat_title_updated', {'chatId': chat_id, 'title': user_message[:50]})

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        stream = client.chat(model=OLLAMA_MODEL, messages=history, stream=True)

        ai_response_content = ""
        first_chunk = True
        for chunk in stream:
            chunk_content = chunk['message']['content']
            ai_response_content += chunk_content
            socketio.emit('response', {'content': chunk_content, 'first_chunk': first_chunk, 'chatId': chat_id}, to=request.sid)
            if first_chunk:
                first_chunk = False

        history.append({'role': 'assistant', 'content': ai_response_content})
        save_chat_history(user_id, chat_id, history)

    except Exception as e:
        print(f"!!! ERROR communicating with Ollama: {e}")
        traceback.print_exc()
        socketio.emit('response_error', {'error': "Sorry, I couldn't connect to the AI model. Please ensure Ollama is running."}, to=request.sid)

if __name__ == '__main__':
    if not os.path.exists(CHAT_SESSIONS_DIR):
        os.makedirs(CHAT_SESSIONS_DIR)
    # The socketio.run command will now use eventlet automatically
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)