document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const chatContainer = document.getElementById('chat-container');
    const typingIndicator = document.getElementById('typing-indicator');
    const newChatButton = document.getElementById('new-chat-button');
    const chatList = document.getElementById('chat-list');
    const chatTitle = document.getElementById('chat-title');

    let userId = localStorage.getItem('theroGptUserId');
    if (!userId) {
        userId = self.crypto.randomUUID();
        localStorage.setItem('theroGptUserId', userId);
    }

    let currentChatId = null;
    let currentAiBubble = null;
    const chunkQueue = [];
    let isTyping = false;
    const TYPING_SPEED = 15;

    // --- Core Functions ---
    function typeWriter() {
        if (isTyping || chunkQueue.length === 0) return;
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
                typeWriter();
            }
        }
        type();
    }

    // --- Chat Management Functions ---
    function loadChats() {
        socket.emit('get_chats', { userId });
    }

    function renderChatList(chats) {
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const listItem = document.createElement('li');
            listItem.dataset.chatId = chat.id;
            listItem.classList.add('chat-list-item');
            if (chat.id === currentChatId) {
                listItem.classList.add('active');
            }

            const chatLink = document.createElement('a');
            chatLink.href = '#';
            chatLink.textContent = chat.title;
            listItem.appendChild(chatLink);

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '&times;';
            deleteButton.classList.add('delete-chat-button');
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this chat?')) {
                    socket.emit('delete_chat', { userId, chatId: chat.id });
                }
            };
            listItem.appendChild(deleteButton);
            
            listItem.addEventListener('click', () => {
                switchChat(chat.id);
            });
            chatList.appendChild(listItem);
        });
    }

    function switchChat(chatId) {
        if (chatId === currentChatId) return;
        
        currentChatId = chatId;
        chatContainer.innerHTML = '';
        showTypingIndicator(false);
        updateActiveChatInList();
        socket.emit('get_history', { userId, chatId });
    }

    function updateActiveChatInList() {
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
    }

    // --- Event Listeners ---
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message && currentChatId) {
            addMessage(message, 'user');
            socket.emit('message', { userId, chatId: currentChatId, message });
            messageInput.value = '';
            showTypingIndicator(true);
            currentAiBubble = null;
        } else if (!currentChatId) {
            alert("Please select a chat or create a new one first.");
        }
    });

    newChatButton.addEventListener('click', () => {
        socket.emit('new_chat', { userId });
    });

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server!');
        loadChats();
    });

    socket.on('chat_list', (data) => {
        renderChatList(data.chats);
        if (!currentChatId && data.chats.length > 0) {
            switchChat(data.chats[0].id);
        } else if (data.chats.length === 0) {
            // If no chats, create one automatically
            socket.emit('new_chat', { userId });
        }
    });
    
    socket.on('chat_history', (data) => {
        chatContainer.innerHTML = '';
        data.history.forEach(msg => {
            addMessage(msg.content, msg.role);
        });
        const activeChat = document.querySelector(`.chat-list-item[data-chat-id="${data.chatId}"] a`);
        chatTitle.textContent = activeChat ? activeChat.textContent : "Chat";
    });

    socket.on('chat_created', (data) => {
        const newChatItem = document.createElement('li');
        newChatItem.dataset.chatId = data.chatId;
        newChatItem.textContent = data.title;
        // For simplicity, just reload the list.
        loadChats();
        switchChat(data.chatId);
    });

    socket.on('chat_deleted', (data) => {
        const itemToDelete = document.querySelector(`li[data-chat-id="${data.chatId}"]`);
        if (itemToDelete) {
            itemToDelete.remove();
        }
        if (currentChatId === data.chatId) {
            currentChatId = null;
            chatContainer.innerHTML = '';
            chatTitle.textContent = "Your Personal AI Assistant";
            const firstChat = chatList.querySelector('li');
            if(firstChat) {
                switchChat(firstChat.dataset.chatId);
            }
        }
    });

    socket.on('response', (data) => {
        // Only process if the response is for the currently active chat
        if (data.chatId !== currentChatId) return;

        showTypingIndicator(false);

        if (data.first_chunk) {
            currentAiBubble = addMessage('', 'ai');
        }
        
        if (currentAiBubble) {
            chunkQueue.push(data.content);
            typeWriter();
        }
    });

    socket.on('response_error', (data) => {
        if (data.chatId !== currentChatId) return;
        showTypingIndicator(false);
        addMessage(data.error, 'error');
    });

    // --- Helper Functions ---
    function addMessage(text, type) {
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble', `${type}-message`);
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        scrollToBottom();
        return bubble;
    }

    function showTypingIndicator(show) {
        typingIndicator.style.display = show ? 'flex' : 'none';
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});