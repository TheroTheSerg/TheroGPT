document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatContainer = document.getElementById('chat-container');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');

    let currentChatId = null;
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = `user_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('userId', userId);
    }

    // --- Helper Functions ---
    function enableMessageForm() {
        messageInput.disabled = false;
        sendButton.style.display = 'inline-block';
        stopButton.style.display = 'none';
        messageInput.focus();
    }

    function disableMessageForm() {
        messageInput.disabled = true;
        sendButton.style.display = 'none';
        stopButton.style.display = 'inline-block';
    }

    function appendMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-bubble');
        messageDiv.dataset.role = role;

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

    // --- Event Listeners ---
    newChatBtn.addEventListener('click', () => {
        socket.emit('new_chat', { userId });
    });

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message && currentChatId) {
            socket.emit('message', { userId, chatId: currentChatId, message });
            appendMessage('user', message);
            messageInput.value = '';
            disableMessageForm();
        }
    });
    
    stopButton.addEventListener('click', () => {
        if (currentChatId) {
            socket.emit('stop_generation', { userId, chatId: currentChatId });
            enableMessageForm();
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

            if (chat.id === currentChatId) {
                li.classList.add('active');
            }
            chatList.appendChild(li);
        });
    });

    socket.on('chat_created', (chat) => {
        socket.emit('get_chats', { userId });
        currentChatId = chat.id;
        socket.emit('get_history', { userId, chatId: currentChatId });
    });
    
    socket.on('chat_history', (data) => {
        chatContainer.innerHTML = '';
        currentChatId = data.chatId;
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
        data.history.forEach(msg => appendMessage(msg.role, msg.content));
        enableMessageForm();
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) return;
        let lastMessage = chatContainer.querySelector('.message-bubble:last-child');
        if (data.first_chunk || !lastMessage || lastMessage.dataset.role !== 'assistant') {
            appendMessage('assistant', data.content);
        } else {
            lastMessage.textContent += data.content;
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
    
    socket.on('response_finished', (data) => {
        if (data.chatId === currentChatId) {
            enableMessageForm();
        }
    });

    socket.on('response_error', (data) => {
        appendMessage('assistant error', data.error);
        enableMessageForm();
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
        }
    });
});