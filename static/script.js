document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatContainer = document.getElementById('chat-container');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    let currentChatId = null;
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = `user_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('userId', userId);
    }
    
    // --- Helper Function to create message bubbles ---
    function appendMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-bubble');
        if (role === 'user') {
            messageDiv.classList.add('user-message');
        } else if (role === 'assistant') {
            messageDiv.classList.add('ai-message');
        } else {
            messageDiv.classList.add('error-message');
        }
        messageDiv.textContent = content;
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // --- Function to send a message ---
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && currentChatId) {
            socket.emit('message', { userId, chatId: currentChatId, message });
            appendMessage('user', message);
            messageInput.value = '';
        }
    }

    // --- Event Listeners ---
    newChatBtn.addEventListener('click', () => {
        socket.emit('new_chat', { userId });
    });

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- Socket.IO Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('get_chats', { userId });
    });

    socket.on('chat_list', (data) => {
        chatList.innerHTML = '';
        data.chats.forEach(chat => {
            const li = document.createElement('li');
            li.className = 'chat-list-item';
            li.dataset.chatId = chat.id;

            const a = document.createElement('a');
            a.href = '#';
            a.textContent = chat.title;
            li.appendChild(a);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-chat-button';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this chat?')) {
                    socket.emit('delete_chat', { userId, chatId: chat.id });
                }
            });
            li.appendChild(deleteBtn);
            
            li.addEventListener('click', (e) => {
                e.preventDefault();
                currentChatId = chat.id;
                socket.emit('get_history', { userId, chatId: currentChatId });
            });

            chatList.appendChild(li);
        });

        // If no chats exist, create one. Otherwise, if no chat is selected, select the first one.
        if (data.chats.length === 0) {
            socket.emit('new_chat', { userId });
        } else if (!currentChatId) {
            currentChatId = data.chats[0].id;
            socket.emit('get_history', { userId, chatId: currentChatId });
        }
        
        // Update the active class on the chat list
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
    });

    socket.on('chat_created', (chat) => {
        socket.emit('get_chats', { userId }); // Refresh the list
        currentChatId = chat.id;
        socket.emit('get_history', { userId, chatId: currentChatId }); // Load the new empty chat
    });
    
    socket.on('chat_history', (data) => {
        chatContainer.innerHTML = '';
        currentChatId = data.chatId;
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
        data.history.forEach(msg => appendMessage(msg.role, msg.content));
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) return;

        let lastMessage = chatContainer.querySelector('.ai-message:last-child');
        if (data.first_chunk || !lastMessage) {
            appendMessage('assistant', data.content);
        } else {
            lastMessage.textContent += data.content;
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });

    socket.on('response_error', (data) => {
        appendMessage('error', data.error);
    });
    
    socket.on('chat_title_updated', (data) => {
        const chatListItem = chatList.querySelector(`[data-chat-id="${data.chatId}"] a`);
        if (chatListItem) {
            chatListItem.textContent = data.title;
        }
    });

    socket.on('chat_deleted', (data) => {
        const itemToRemove = chatList.querySelector(`[data-chat-id="${data.chatId}"]`);
        if (itemToRemove) {
            itemToRemove.remove();
        }
        if (currentChatId === data.chatId) {
            chatContainer.innerHTML = '';
            currentChatId = null;
            // After deleting, check if there are other chats and select the first one
            socket.emit('get_chats', { userId });
        }
    });
});