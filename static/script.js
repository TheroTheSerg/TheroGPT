document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const chatContainer = document.getElementById('chat-container');
    const typingIndicator = document.getElementById('typing-indicator');

    let currentAiBubble = null;

    // --- Event Listeners ---

    // Handle form submission
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message) {
            addMessage(message, 'user');
            socket.emit('message', { message });
            messageInput.value = '';
            showTypingIndicator(true);
            currentAiBubble = null; // Reset for the new response
        }
    });

    // Handle incoming response chunks from the server
    socket.on('response', (data) => {
        showTypingIndicator(false);
        if (data.first_chunk) {
            currentAiBubble = addMessage('', 'ai');
        }
        if (currentAiBubble) {
            currentAiBubble.textContent += data.content;
            scrollToBottom();
        }
    });

    // Handle errors from the server
    socket.on('response_error', (data) => {
        showTypingIndicator(false);
        addMessage(data.error, 'error');
    });

    // --- Helper Functions ---

    /**
     * Adds a message bubble to the chat container.
     * @param {string} text - The message text.
     * @param {'user'|'ai'|'error'} type - The type of message.
     * @returns {HTMLElement} The created message bubble element.
     */
    function addMessage(text, type) {
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble', `${type}-message`);
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        scrollToBottom();
        return bubble;
    }

    /**
     * Controls the visibility of the typing indicator.
     * @param {boolean} show - Whether to show or hide the indicator.
     */
    function showTypingIndicator(show) {
        typingIndicator.style.display = show ? 'flex' : 'none';
    }

    /**
     * Scrolls the chat container to the latest message.
     */
    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});