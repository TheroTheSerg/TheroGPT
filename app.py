import os
import json
import uuid
import eventlet
from duckduckgo_search import DDGS
import requests
from bs4 import BeautifulSoup

eventlet.monkey_patch()

from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_cors import CORS
import ollama

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, async_mode='eventlet')

# --- Configuration ---
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma2:2b")
CHAT_SESSIONS_DIR = 'chat_sessions'
SYSTEM_PROMPT_DEFAULT = "You are TheroGPT, a helpful AI assistant. You do NOT have access to the internet or live search results."
SYSTEM_PROMPT_WEB = "You are TheroGPT, a helpful AI assistant. You have been provided with a series of web search results. Please use them to answer the user's query."

stop_generating = {} # Tracks stop requests by session ID

# --- Helper Functions ---

def get_chat_filepath(user_id, chat_id):
    user_dir = os.path.join(CHAT_SESSIONS_DIR, user_id)
    return os.path.join(user_dir, f"{chat_id}.json")

def search_the_web(query):
    """
    Performs a web search using DuckDuckGo, formats the results, 
    and fetches the content of the top result.
    """
    print(f"Performing web search for: {query}")
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
            if not results:
                return "No search results found."

            # Fetch content from the first result
            top_result_content = ""
            if results and results[0].get('href'):
                try:
                    url = results[0]['href']
                    print(f"Fetching content from: {url}")
                    # Use eventlet-friendly requests if available, or standard requests
                    response = requests.get(url, timeout=5)
                    response.raise_for_status()
                    
                    # Use BeautifulSoup to extract text content
                    soup = BeautifulSoup(response.content, 'lxml')
                    for script_or_style in soup(["script", "style"]):
                        script_or_style.decompose()
                    text = soup.get_text(separator='\n', strip=True)
                    top_result_content = f"\n\n--- Content from Top Result ---\n{text[:2000]}\n--- End of Content ---"
                except Exception as e:
                    print(f"Error fetching content from {results[0]['href']}: {e}")
                    top_result_content = "\n\n[Could not fetch content from the top result.]"

            # Enumerate and format the results for clarity
            formatted_results = []
            for i, r in enumerate(results, 1):
                formatted_results.append(
                    f"[{i}] Title: {r.get('title', 'N/A')}\n"
                    f"Snippet: {r.get('body', 'N/A')}\n"
                    f"URL: {r.get('href', 'N/A')}"
                )
            
            return "\n\n".join(formatted_results) + top_result_content

    except Exception as e:
        print(f"Error during web search: {e}")
        return "An error occurred during the web search. Please try again later."


def load_chat_history(user_id, chat_id, use_internet=False):
    filepath = get_chat_filepath(user_id, chat_id)
    system_prompt = SYSTEM_PROMPT_WEB if use_internet else SYSTEM_PROMPT_DEFAULT
    if not os.path.exists(filepath):
        return [{'role': 'system', 'content': system_prompt}]
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            history = json.loads(content) if content else []
            if not history or history[0].get('role') != 'system':
                history.insert(0, {'role': 'system', 'content': system_prompt})
            else:
                history[0]['content'] = system_prompt # Update system prompt
            return history
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error loading chat history for {chat_id}: {e}")
        return [{'role': 'system', 'content': system_prompt}]

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

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    if request.sid in stop_generating:
        del stop_generating[request.sid]

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

@socketio.on('stop_generation')
def handle_stop_generation(data):
    stop_generating[request.sid] = True
    print(f"Stop request received for SID: {request.sid}")

@socketio.on('message')
def handle_message(data):
    user_id = data.get('userId')
    chat_id = data.get('chatId')
    user_message = data.get('message')
    use_internet = data.get('useInternet', False)

    history = load_chat_history(user_id, chat_id, use_internet)
    is_first_user_message = not any(msg['role'] == 'user' for msg in history)

    if use_internet:
        search_results = search_the_web(user_message)
        history.append({'role': 'system', 'content': f"Web search results:\n{search_results}"})

    history.append({'role': 'user', 'content': user_message})
    save_chat_history(user_id, chat_id, history)

    if is_first_user_message:
        socketio.emit('chat_title_updated', {'chatId': chat_id, 'title': user_message[:50]})

    try:
        stop_generating[request.sid] = False
        client = ollama.Client(host=OLLAMA_HOST)
        stream = client.chat(model=OLLAMA_MODEL, messages=history, stream=True)

        ai_response_content = ""
        first_chunk = True
        for chunk in stream:
            if stop_generating.get(request.sid):
                print(f"Stopping generation for SID: {request.sid}")
                break

            chunk_content = chunk['message']['content']
            ai_response_content += chunk_content
            socketio.emit('response', {'content': chunk_content, 'first_chunk': first_chunk, 'chatId': chat_id}, to=request.sid)
            if first_chunk:
                first_chunk = False

        history.append({'role': 'assistant', 'content': ai_response_content})
        save_chat_history(user_id, chat_id, history)

    except Exception as e:
        print(f"!!! ERROR communicating with Ollama: {e}")
        socketio.emit('response_error', {'error': "Sorry, I couldn't connect to the AI model. Please ensure Ollama is running."}, to=request.sid)
    
    finally:
        status = 'stopped' if stop_generating.get(request.sid) else 'completed'
        socketio.emit('response_end', {'chatId': chat_id, 'status': status}, to=request.sid)
        if request.sid in stop_generating:
            del stop_generating[request.sid]

if __name__ == '__main__':
    if not os.path.exists(CHAT_SESSIONS_DIR):
        os.makedirs(CHAT_SESSIONS_DIR)
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)