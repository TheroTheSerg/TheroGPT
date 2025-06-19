import os
import json
import uuid
import traceback
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

# --- Helper Functions (with enhanced logging) ---

def get_user_chat_dir(user_id):
    return os.path.join(CHAT_SESSIONS_DIR, user_id)

def get_chat_filepath(user_id, chat_id):
    return os.path.join(get_user_chat_dir(user_id), f"{chat_id}.json")

def load_chat_history(user_id, chat_id):
    filepath = get_chat_filepath(user_id, chat_id)
    print(f"Attempting to load history from: {filepath}")
    if not os.path.exists(filepath):
        print("File not found, returning empty history.")
        return []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            # Handle empty file case
            content = f.read()
            if not content:
                print("File is empty, returning empty history.")
                return []
            print("File found, loading JSON.")
            return json.loads(content)
    except Exception as e:
        print(f"!!! ERROR loading chat history for {chat_id}: {e}")
        traceback.print_exc()
        return []

def save_chat_history(user_id, chat_id, history):
    filepath = get_chat_filepath(user_id, chat_id)
    print(f"Attempting to save history to: {filepath}")
    try:
        os.makedirs(get_user_chat_dir(user_id), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=4, ensure_ascii=False)
        print(f"Successfully saved history for chat {chat_id}.")
    except Exception as e:
        print(f"!!! ERROR saving chat history for {chat_id}: {e}")
        traceback.print_exc()

# --- Flask & Socket.IO (with enhanced logging) ---

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f"--- Client connected: {request.sid} ---")

@socketio.on('get_chats')
def handle_get_chats(data):
    user_id = data.get('userId')
    print(f"--> Received 'get_chats' for userId: {user_id}")
    if not user_id:
        return

    user_dir = get_user_chat_dir(user_id)
    if not os.path.exists(user_dir):
        print(f"<-- Emitting 'chat_list' with no chats for userId: {user_id}")
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

    print(f"<-- Emitting 'chat_list' with {len(chats)} chats for userId: {user_id}")
    socketio.emit('chat_list', {'chats': chats}, to=request.sid)

@socketio.on('get_history')
def handle_get_history(data):
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    print(f"--> Received 'get_history' for chatId: {chat_id}")
    history = load_chat_history(user_id, chat_id)
    print(f"<-- Emitting 'chat_history' for chatId: {chat_id} with {len(history)} messages.")
    socketio.emit('chat_history', {'chatId': chat_id, 'history': history}, to=request.sid)

@socketio.on('new_chat')
def handle_new_chat(data):
    user_id = data.get('userId')
    print(f"--> Received 'new_chat' for userId: {user_id}")
    chat_id = str(uuid.uuid4())
    save_chat_history(user_id, chat_id, [])
    print(f"<-- Emitting 'chat_created' for new chatId: {chat_id}")
    socketio.emit('chat_created', {'id': chat_id, 'title': 'New Chat'}, to=request.sid)

@socketio.on('delete_chat')
def handle_delete_chat(data):
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    print(f"--> Received 'delete_chat' for chatId: {chat_id}")
    filepath = get_chat_filepath(user_id, chat_id)
    if os.path.exists(filepath):
        os.remove(filepath)
        print(f"Deleted chat file: {filepath}")
        socketio.emit('chat_deleted', {'chatId': chat_id}, to=request.sid)

@socketio.on('message')
def handle_message(data):
    user_id, chat_id, user_message = data.get('userId'), data.get('chatId'), data.get('message')
    print(f"--> Received 'message' for chatId: {chat_id}. Message: '{user_message}'")
    
    history = load_chat_history(user_id, chat_id)
    is_first_user_message = not any(msg['role'] == 'user' for msg in history)
    
    history.append({'role': 'user', 'content': user_message})
    save_chat_history(user_id, chat_id, history)

    if is_first_user_message:
        new_title = user_message[:50]
        print(f"<-- Emitting 'chat_title_updated' for chatId {chat_id}. New title: '{new_title}'")
        socketio.emit('chat_title_updated', {'chatId': chat_id, 'title': new_title})

    try:
        print("Streaming response from Ollama...")
        client = ollama.Client(host=OLLAMA_HOST)
        stream = client.chat(model=OLLAMA_MODEL, messages=history, stream=True)

        ai_response_content = ""
        for chunk in stream:
            ai_response_content += chunk['message']['content']
            socketio.emit('response', {'content': chunk['message']['content'], 'chatId': chat_id}, to=request.sid)

        print("Ollama stream finished.")
        history.append({'role': 'assistant', 'content': ai_response_content})
        save_chat_history(user_id, chat_id, history)

    except Exception as e:
        print(f"!!! ERROR communicating with Ollama: {e}")
        traceback.print_exc()
        socketio.emit('response_error', {'error': "Error connecting to the AI model."}, to=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    print(f"--- Client disconnected: {request.sid} ---")

if __name__ == '__main__':
    if not os.path.exists(CHAT_SESSIONS_DIR):
        os.makedirs(CHAT_SESSIONS_DIR)
    print("Starting Flask-SocketIO server...")
    socketio.run(app, host="0.0.0.0", debug=True, allow_unsafe_werkzeug=True)