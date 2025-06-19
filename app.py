import os
import ollama
from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app)

# In-memory store for chat histories, mapping session IDs to message lists
chat_histories = {}

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@socketio.on('message')
def handle_message(data):
    """
    Handles a new message from a client, sends it to Ollama,
    and streams the response back.
    """
    session_id = request.sid
    user_message = data['message']

    # Retrieve or create the chat history for the session
    if session_id not in chat_histories:
        chat_histories[session_id] = []
    
    # Add the new user message to the history
    chat_histories[session_id].append({'role': 'user', 'content': user_message})

    # Get Ollama configuration from environment variables or use defaults
    ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    ollama_model = os.environ.get("OLLAMA_MODEL", "llama2")

    try:
        # Initialize the Ollama client
        client = ollama.Client(host=ollama_host)
        
        # Stream the response from Ollama
        stream = client.chat(
            model=ollama_model,
            messages=chat_histories[session_id],
            stream=True
        )

        # Create a placeholder for the full AI response
        ai_response_content = ""
        first_chunk = True
        
        for chunk in stream:
            chunk_content = chunk['message']['content']
            ai_response_content += chunk_content
            
            # Emit the chunk to the client
            socketio.emit('response', {'content': chunk_content, 'first_chunk': first_chunk}, to=session_id)
            if first_chunk:
                first_chunk = False

        # Add the full AI response to the history
        chat_histories[session_id].append({'role': 'assistant', 'content': ai_response_content})

    except Exception as e:
        print(f"Error communicating with Ollama: {e}")
        error_message = "Sorry, I'm having trouble connecting to the AI model. Please check if Ollama is running."
        socketio.emit('response_error', {'error': error_message}, to=session_id)

@socketio.on('disconnect')
def handle_disconnect():
    """Clears the chat history for a disconnected user."""
    session_id = request.sid
    if session_id in chat_histories:
        del chat_histories[session_id]
    print(f"Client disconnected: {session_id}. History cleared.")

if __name__ == '__main__':
    socketio.run(app, host="0.0.0.0", debug=True)