// --- TheroGPT script.js ---
// Generate a pseudo-unique session id per browser tab
let sessionId = localStorage.getItem("therogpt-session-id");
if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 12);
    localStorage.setItem("therogpt-session-id", sessionId);
}

let socket = io();
let currentBotMsg = null;

const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const messagesDiv = document.getElementById('messages');

// Optional: Reset memory button (add one to your HTML if you want)
const resetBtn = document.getElementById('reset-memory');

if (resetBtn) {
    resetBtn.addEventListener("click", function() {
        fetch("/reset_memory", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({session_id: sessionId})
        }).then(() => {
            messagesDiv.innerHTML = "";
            currentBotMsg = null;
        });
    });
}

chatForm.addEventListener("submit", function(e) {
    e.preventDefault();
    const userMsg = messageInput.value.trim();
    if (!userMsg) return;
    appendMessage(userMsg, "user");
    socket.emit("user_message", {message: userMsg, session_id: sessionId});
    messageInput.value = "";
    messageInput.focus();
    currentBotMsg = null;
});

socket.on("bot_message", function(data) {
    if (!currentBotMsg) {
        currentBotMsg = appendMessage("", "bot");
    }
    // Streaming tokens: append as they arrive
    currentBotMsg.textContent += data.message;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

function appendMessage(text, role) {
    const msgDiv = document.createElement("div");
    msgDiv.className = role === "user" ? "user-message" : "bot-message";
    msgDiv.textContent = text;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv;
}
