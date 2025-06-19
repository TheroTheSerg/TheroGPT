import requests
import json
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = "super-secret-key"
socketio = SocketIO(app, cors_allowed_origins="*")

# Memory: store chat history per session (not persistent, but easily made so)
chat_histories = {}
MAX_HISTORY = 10

SYSTEM_PROMPT = "You are a helpful assistant."

def build_prompt(history):
    # Format history for Dolphin-mistral (OpenChat/ChatML)
    prompt = f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
    for m in history:
        if m["role"] == "user":
            prompt += f"<|im_start|>user\n{m['content']}<|im_end|>\n"
        else:
            prompt += f"<|im_start|>assistant\n{m['content']}<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"  # Start of next assistant reply
    return prompt

@app.route("/")
def index():
    return render_template("index.html")

def ollama_stream(user_input, session_id):
    # Fetch and update history
    history = chat_histories.get(session_id, [])
    history.append({"role": "user", "content": user_input})
    history = history[-MAX_HISTORY:]
    formatted_prompt = build_prompt(history)
    payload = {
        "model": "dolphin-mistral",
        "prompt": formatted_prompt,
        "stream": True
    }
    url = "http://localhost:11434/api/generate"
    with requests.post(url, json=payload, stream=True) as resp:
        assistant_reply = ""
        for line in resp.iter_lines():
            if line:
                try:
                    data = json.loads(line.decode("utf-8"))
                    if "response" in data:
                        token = data["response"]
                        assistant_reply += token
                        yield token
                except Exception:
                    continue
        # Save full assistant reply to history
        history.append({"role": "assistant", "content": assistant_reply})
        chat_histories[session_id] = history[-MAX_HISTORY:]

@socketio.on("user_message")
def handle_user_message(data):
    user_msg = data.get("message")
    session_id = data.get("session_id", "default")
    if not user_msg:
        return
    for chunk in ollama_stream(user_msg, session_id):
        emit("bot_message", {"message": chunk})

# Optional: reset chat memory endpoint
@app.route("/reset_memory", methods=["POST"])
def reset_memory():
    session_id = request.json.get("session_id", "default")
    chat_histories.pop(session_id, None)
    return {"status": "ok"}

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
