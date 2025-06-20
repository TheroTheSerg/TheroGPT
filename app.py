import os
import json
import uuid
import eventlet
import datetime
import sys
# Replaced eventlet.tpool with Python's standard ThreadPoolExecutor
from concurrent.futures import ThreadPoolExecutor
from duckduckgo_search import DDGS
import requests
from bs4 import BeautifulSoup

eventlet.monkey_patch()

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
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


def fetch_and_parse(url):
    """
    Fetches content from a URL, cleans it, and extracts text.
    This function is now run in a standard thread pool to avoid library conflicts.
    """
    try:
        print(f"Fetching content from: {url}")
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, timeout=10, headers=headers)
        response.raise_for_status()

        content_type = response.headers.get('Content-Type', '')
        if 'text/html' not in content_type:
            print(f"Skipping non-HTML content at {url}")
            return None
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'link', 'meta', 'noscript']):
            tag.decompose()
        
        text = ' '.join(soup.stripped_strings)
            
        return text

    except requests.exceptions.RequestException as e:
        print(f"Request failed for {url}: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred processing {url}: {e}")
        return None

def search_the_web(query):
    """
    Performs a web search, fetching content concurrently using standard threads.
    """
    print(f"Performing web search for: {query}")
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))

        if not results:
            return "No search results found."

        urls_to_fetch = [r['href'] for r in results[:3] if 'href' in r]
        
        # Use a standard ThreadPoolExecutor to run scraping in isolated, standard threads.
        # This prevents conflicts with eventlet's monkey-patching.
        fetched_contents = []
        with ThreadPoolExecutor(max_workers=3) as executor:
            fetched_contents = list(executor.map(fetch_and_parse, urls_to_fetch))

        context_parts = []
        for i, content in enumerate(fetched_contents):
            if content:
                result_meta = results[i]
                context_parts.append(
                    f"Source [{i+1}]: {result_meta.get('title', 'N/A')}\n"
                    f"URL: {result_meta.get('href', 'N/A')}\n"
                    f"CONTENT:\n{content[:2500]}\n"
                )

        if not context_parts:
            return "Could not retrieve content from any search results. Please try a different query."
            
        return "\n---\n".join(context_parts)

    except Exception as e:
        print(f"An error occurred in the main search function: {e}")
        return "Sorry, an error occurred during the web search."

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
                history[0]['content'] = system_prompt
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
        emit('chat_list', {'chats': []}, to=request.sid)
        return

    chat_files = [f for f in os.listdir(user_dir) if f.endswith('.json')]
    chats = []
    for filename in sorted(chat_files, key=lambda f: os.path.getmtime(os.path.join(user_dir, f)), reverse=True):
        chat_id = os.path.splitext(filename)[0]
        history = load_chat_history(user_id, chat_id)
        title = next((msg['content'] for msg in history if msg['role'] == 'user'), 'New Chat')
        chats.append({'id': chat_id, 'title': title[:50]})
    emit('chat_list', {'chats': chats}, to=request.sid)

@socketio.on('get_history')
def handle_get_history(data):
    user_id, chat_id = data.get('userId'), data.get('chatId')
    history = load_chat_history(user_id, chat_id)
    display_history = [msg for msg in history if msg['role'] != 'system']
    emit('chat_history', {'chatId': chat_id, 'history': display_history}, to=request.sid)

@socketio.on('new_chat')
def handle_new_chat(data):
    user_id = data.get('userId')
    if not user_id: return
    chat_id = str(uuid.uuid4())
    save_chat_history(user_id, chat_id, [])
    emit('chat_created', {'id': chat_id, 'title': 'New Chat'}, to=request.sid)

@socketio.on('delete_chat')
def handle_delete_chat(data):
    user_id, chat_id = data.get('userId'), data.get('chatId')
    filepath = get_chat_filepath(user_id, chat_id)
    if os.path.exists(filepath):
        os.remove(filepath)
    emit('chat_deleted', {'chatId': chat_id}, to=request.sid)

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
    
    time_query_triggers = [
        'what time is it', 'what is the time', 'current time', 'time', "what's the time"
    ]
    date_query_triggers = [
        "what's today's date", "what is todays date", "what is today's date", 
        'what is the date', 'what is today', 'date', 'today'
    ]
    normalized_message = user_message.lower().strip().rstrip('?').strip()

    if use_internet and (normalized_message in time_query_triggers or normalized_message in date_query_triggers):
        now = datetime.datetime.now()
        date_str = now.strftime("%A, %B %d, %Y")
        time_str = now.strftime("%I:%M %p")

        if normalized_message in time_query_triggers:
            ai_response_content = f"The current time is {time_str}."
        else:
            ai_response_content = f"Today is {date_str}."
        
        history.append({'role': 'user', 'content': user_message})
        history.append({'role': 'assistant', 'content': ai_response_content})
        save_chat_history(user_id, chat_id, history)
        
        emit('response', {'content': ai_response_content, 'first_chunk': True, 'chatId': chat_id}, to=request.sid)
        emit('response_end', {'chatId': chat_id, 'status': 'completed'}, to=request.sid)
        return

    if use_internet:
        search_results = search_the_web(user_message)
        history.append({'role': 'system', 'content': f"Web search results:\n{search_results}"})

    history.append({'role': 'user', 'content': user_message})
    
    if is_first_user_message:
        emit('chat_title_updated', {'chatId': chat_id, 'title': user_message[:50]})

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
            emit('response', {'content': chunk_content, 'first_chunk': first_chunk, 'chatId': chat_id}, to=request.sid)
            if first_chunk:
                first_chunk = False
        
        if ai_response_content:
             history.append({'role': 'assistant', 'content': ai_response_content})
        
        history_to_save = [msg for msg in history if not (msg['role'] == 'system' and msg.get('content', '').startswith('Web search results'))]
        save_chat_history(user_id, chat_id, history_to_save)

    except Exception as e:
        print(f"!!! ERROR communicating with Ollama: {e}")
        emit('response_error', {'error': "Sorry, I couldn't connect to the AI model. Please ensure Ollama is running."}, to=request.sid)
    
    finally:
        status = 'stopped' if stop_generating.get(request.sid) else 'completed'
        emit('response_end', {'chatId': chat_id, 'status': status}, to=request.sid)
        if request.sid in stop_generating:
            del stop_generating[request.sid]

if __name__ == '__main__':
    if not os.path.exists(CHAT_SESSIONS_DIR):
        os.makedirs(CHAT_SESSIONS_DIR)
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)