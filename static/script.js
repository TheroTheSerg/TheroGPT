document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatHistory = document.getElementById('chat-history');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');

    let currentChatId = null;
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = `user_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('userId', userId);
    }

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
        }
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('get_chats', { userId });
    });

    socket.on('chat_list', (data) => {
        chatList.innerHTML = '';
        data.chats.forEach(chat => {
            const li = document.createElement('li');
            li.textContent = chat.title;
            li.dataset.chatId = chat.id;
            li.addEventListener('click', () => {
                currentChatId = chat.id;
                socket.emit('get_history', { userId, chatId: currentChatId });
                document.querySelectorAll('#chat-list li').forEach(item => item.classList.remove('active'));
                li.classList.add('active');
            });
            chatList.appendChild(li);
        });
    });

    socket.on('chat_created', (chat) => {
        socket.emit('get_chats', { userId });
        currentChatId = chat.id;
        socket.emit('get_history', { userId, chatId: currentChatId });
    });
    
    socket.on('chat_history', (data) => {
        chatHistory.innerHTML = '';
        currentChatId = data.chatId;
        data.history.forEach(msg => appendMessage(msg.role, msg.content));
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) return;

        let lastMessage = chatHistory.querySelector('.message:last-child');
        if (data.first_chunk || !lastMessage || lastMessage.dataset.role !== 'assistant') {
            appendMessage('assistant', data.content);
        } else {
            lastMessage.querySelector('.content').innerHTML += data.content;
        }
        chatHistory.scrollTop = chatHistory.scrollHeight;
    });

    socket.on('response_error', (data) => {
        appendMessage('assistant error', data.error);
    });
    
    socket.on('chat_title_updated', (data) => {
        if (data.chatId === currentChatId) {
             const chatListItem = chatList.querySelector(`[data-chat-id="${data.chatId}"]`);
             if (chatListItem) {
                 chatListItem.textContent = data.title;
             }
        }
    });

    function appendMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${role}-message`);
        messageDiv.dataset.role = role;
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
});