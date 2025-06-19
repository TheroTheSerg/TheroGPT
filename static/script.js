document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const chatContainer = document.getElementById('chat-container');
    const typingIndicator = document.getElementById('typing-indicator');
    const clearButton = document.getElementById('clear-button');

    let currentAiBubble = null;
    const chunkQueue = [];
    let isTyping = false;
    const TYPING_SPEED = 15; // Milliseconds between characters

    // --- Core Functions ---

    /**
     * Takes text chunks from the queue and "types" them out character by character.
     */
    function typeWriter() {
        if (isTyping || chunkQueue.length === 0) {
            return;
        }
        isTyping = true;
        const chunk = chunkQueue.shift();
        let i = 0;

        function type() {
            if (i < chunk.length) {
                currentAiBubble.textContent += chunk.charAt(i);
                i++;
                scrollToBottom();
                setTimeout(type, TYPING_SPEED);
            } else {
                isTyping = false;
                // Immediately check for and start typing the next chunk
                typeWriter(); 
            }
        }
        type();
    }

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

    // Handle clear chat button click
    clearButton.addEventListener('click', () => {
        socket.emit('clear_history');
    });

    // --- Socket.IO Event Handlers ---

    // Handle incoming response chunks from the server
    socket.on('response', (data) => {
        showTypingIndicator(false);

        if (data.first_chunk) {
            currentAiBubble = addMessage('', 'ai');
        }
        
        if (currentAiBubble) {
            // Add the received chunk to the queue and start the typewriter
            chunkQueue.push(data.content);
            typeWriter();
        }
    });

    // Handle errors from the server
    socket.on('response_error', (data) => {
        showTypingIndicator(false);
        addMessage(data.error, 'error');
    });

    // Handle history cleared confirmation
    socket.on('history_cleared', (data) => {
        chatContainer.innerHTML = ''; // Clear the chat display
        console.log(data.message);
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