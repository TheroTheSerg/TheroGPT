import os
import json
import uuid
import traceback
import re
import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_cors import CORS
import ollama
from Google_Search import search


app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, async_mode='eventlet')

# --- Configuration ---
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")
CHAT_SESSIONS_DIR = 'chat_sessions'
SYSTEM_PROMPT = """You are TheroGPT, a helpful AI assistant. You have the ability to search the internet for current information.
To search the internet, output `[search: QUERY]` where QUERY is what you want to search for.
You will be provided with the search results, and you can then use them to answer the user's question."""

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
            # Start with the system prompt if the history is empty or doesn't have it
            history = json.loads(content) if content else []
            if not history or history[0].get('role') != 'system':
                history.insert(0, {'role': 'system', 'content': SYSTEM_PROMPT})
            return history
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error loading chat history for {chat_id}: {e}")
        return [{'role': 'system', 'content': SYSTEM_PROMPT}]

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
    # Don't show the system prompt to the user
    display_history = [msg for msg in history if msg['role'] != 'system']
    socketio.emit('chat_history', {'chatId': chat_id, 'history': display_history}, to=request.sid)

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

        # First, get the AI's response to see if it wants to search
        initial_response = client.chat(model=OLLAMA_MODEL, messages=history, stream=False)
        ai_message = initial_response['message']['content']

        search_match = re.search(r'\[search:\s*(.*)\]', ai_message)

        if search_match:
            query = search_match.group(1)
            history.append({'role': 'assistant', 'content': ai_message}) # Save the search request
            
            try:
                search_results = search(queries=[query])
                search_context = ""
                for result in search_results:
                    for item in result.results:
                        search_context += f"URL: {item.url}\nTitle: {item.source_title}\nSnippet: {item.snippet}\n\n"
                history.append({'role': 'tool', 'content': search_context})
            except Exception as e:
                print(f"Error during Google Search: {e}")
                history.append({'role': 'tool', 'content': 'There was an error while searching the internet.'})

            # Now, get the final answer with the search results
            stream = client.chat(model=OLLAMA_MODEL, messages=history, stream=True)
        else:
            # If no search is needed, just stream the initial response
            stream = (chunk for chunk in [initial_response])

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
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)