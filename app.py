import os
import json
import uuid
from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_cors import CORS
import ollama

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app)

# --- Configuration ---
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")
CHAT_SESSIONS_DIR = 'chat_sessions'

# --- Helper Functions ---

def get_user_chat_dir(user_id):
    """Returns the directory for a specific user's chats."""
    return os.path.join(CHAT_SESSIONS_DIR, user_id)

def get_chat_filepath(user_id, chat_id):
    """Returns the full path to a chat history file."""
    return os.path.join(get_user_chat_dir(user_id), f"{chat_id}.json")

def load_chat_history(user_id, chat_id):
    """Loads a chat history from a file."""
    filepath = get_chat_filepath(user_id, chat_id)
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def save_chat_history(user_id, chat_id, history):
    """Saves a chat history to a file."""
    user_dir = get_user_chat_dir(user_id)
    os.makedirs(user_dir, exist_ok=True)
    filepath = get_chat_filepath(user_id, chat_id)
    with open(filepath, 'w') as f:
        json.dump(history, f, indent=4)

# --- Flask Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

# --- Socket.IO Event Handlers ---

@socketio.on('connect')
def handle_connect():
    """A new user has connected."""
    print(f"Client connected: {request.sid}")

@socketio.on('get_chats')
def handle_get_chats(data):
    """Returns the list of existing chats for a user."""
    user_id = data.get('userId')
    if not user_id:
        return

    user_dir = get_user_chat_dir(user_id)
    if not os.path.exists(user_dir):
        socketio.emit('chat_list', {'chats': []}, to=request.sid)
        return

    chat_files = [f for f in os.listdir(user_dir) if f.endswith('.json')]
    chats = []
    for filename in sorted(chat_files, key=lambda f: os.path.getmtime(os.path.join(user_dir, f)), reverse=True):
        chat_id = os.path.splitext(filename)[0]
        history = load_chat_history(user_id, chat_id)
        title = next((msg['content'] for msg in history if msg['role'] == 'user'), 'New Chat')
        chats.append({'id': chat_id, 'title': title[:50]}) # Truncate title

    socketio.emit('chat_list', {'chats': chats}, to=request.sid)

@socketio.on('get_history')
def handle_get_history(data):
    """Returns the history for a specific chat."""
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    if not user_id or not chat_id:
        return

    history = load_chat_history(user_id, chat_id)
    socketio.emit('chat_history', {'chatId': chat_id, 'history': history}, to=request.sid)


@socketio.on('new_chat')
def handle_new_chat(data):
    """Creates a new chat session for the user."""
    user_id = data.get('userId')
    if not user_id:
        return
    
    chat_id = str(uuid.uuid4())
    save_chat_history(user_id, chat_id, []) # Create an empty history file
    socketio.emit('chat_created', {'id': chat_id, 'title': 'New Chat'}, to=request.sid)


@socketio.on('delete_chat')
def handle_delete_chat(data):
    """Deletes a chat session."""
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    if not user_id or not chat_id:
        return

    filepath = get_chat_filepath(user_id, chat_id)
    if os.path.exists(filepath):
        os.remove(filepath)
        print(f"Deleted chat {chat_id} for user {user_id}")
        socketio.emit('chat_deleted', {'chatId': chat_id}, to=request.sid)


@socketio.on('message')
def handle_message(data):
    """
    Handles a new message from a client, sends it to Ollama,
    and streams the response back.
    """
    session_id = request.sid
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    user_message = data['message']

    if not user_id or not chat_id:
        print("Error: userId or chatId not provided.")
        return

    history = load_chat_history(user_id, chat_id)
    
    # Check if this is the first user message to update the title
    is_first_message = not any(msg['role'] == 'user' for msg in history)

    history.append({'role': 'user', 'content': user_message})
    
    # --- FIX: Save user message immediately ---
    save_chat_history(user_id, chat_id, history)

    # --- FIX: Emit title update if it's the first message ---
    if is_first_message:
        socketio.emit('chat_title_updated', {'chatId': chat_id, 'title': user_message[:50]}, to=session_id)

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        stream = client.chat(
            model=OLLAMA_MODEL,
            messages=history,
            stream=True
        )

        ai_response_content = ""
        first_chunk = True
        
        for chunk in stream:
            chunk_content = chunk['message']['content']
            ai_response_content += chunk_content
            socketio.emit('response', {'content': chunk_content, 'first_chunk': first_chunk, 'chatId': chat_id}, to=session_id)
            if first_chunk:
                first_chunk = False

        history.append({'role': 'assistant', 'content': ai_response_content})
        save_chat_history(user_id, chat_id, history)

    except Exception as e:
        print(f"Error communicating with Ollama: {e}")
        error_message = "Sorry, I'm having trouble connecting to the AI model. Please check if Ollama is running."
        socketio.emit('response_error', {'error': error_message, 'chatId': chat_id}, to=session_id)


@socketio.on('disconnect')
def handle_disconnect():
    """A client has disconnected."""
    print(f"Client disconnected: {request.sid}")

if __name__ == '__main__':
    if not os.path.exists(CHAT_SESSIONS_DIR):
        os.makedirs(CHAT_SESSIONS_DIR)
    socketio.run(app, host="0.0.0.0", debug=True)