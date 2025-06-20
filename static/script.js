document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const chatWindow = document.getElementById('chat-window');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatList = document.getElementById('chat-list');
    const internetSearchToggle = document.getElementById('internet-search-toggle');

    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userId', userId);
    }

    let currentChatId = null;

    function createChatElement(chat) {
        const chatElement = document.createElement('div');
        chatElement.classList.add('chat-item');
        chatElement.dataset.chatId = chat.id;
        chatElement.textContent = chat.title;
        chatElement.addEventListener('click', () => {
            currentChatId = chat.id;
            chatWindow.innerHTML = '';
            socket.emit('get_history', { userId, chatId: chat.id });
        });
        return chatElement;
    }

    function appendMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);
        messageElement.textContent = text;
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    sendBtn.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message) {
            appendMessage('user', message);
            socket.emit('message', { 
                userId, 
                chatId: currentChatId, 
                message,
                useInternet: internetSearchToggle.checked
            });
            messageInput.value = '';
        }
    });

    newChatBtn.addEventListener('click', () => {
        socket.emit('new_chat', { userId });
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('get_chats', { userId });
    });

    socket.on('chat_list', (data) => {
        chatList.innerHTML = '';
        data.chats.forEach(chat => {
            chatList.appendChild(createChatElement(chat));
        });
    });

    socket.on('chat_created', (data) => {
        const chatElement = createChatElement(data);
        chatList.prepend(chatElement);
        currentChatId = data.id;
        chatWindow.innerHTML = '';
    });

    socket.on('chat_history', (data) => {
        chatWindow.innerHTML = '';
        data.history.forEach(message => {
            appendMessage(message.role, message.content);
        });
    });

    socket.on('response', (data) => {
        if (data.first_chunk) {
            const assistantMessage = document.createElement('div');
            assistantMessage.classList.add('message', 'assistant');
            chatWindow.appendChild(assistantMessage);
        }
        const lastMessage = chatWindow.querySelector('.message.assistant:last-child');
        if (lastMessage) {
            lastMessage.textContent += data.content;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });

    socket.on('chat_title_updated', (data) => {
        const chatElement = document.querySelector(`.chat-item[data-chat-id="${data.chatId}"]`);
        if (chatElement) {
            chatElement.textContent = data.title;
        }
    });

    socket.on('response_error', (data) => {
        appendMessage('assistant', `Error: ${data.error}`);
    });
});