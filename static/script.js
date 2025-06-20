document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const chatWindow = document.getElementById('chat-window');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatList = document.getElementById('chat-list');
    const internetSearchToggle = document.getElementById('internet-search-toggle');
    const converter = new showdown.Converter({
        omitExtraWLInCodeBlocks: true,
        simplifiedAutoLink: true,
        strikethrough: true,
        tables: true,
        tasklists: true,
        simpleLineBreaks: true
    });

    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userId', userId);
    }

    let currentChatId = null;
    let currentResponseContent = '';
    let isResponding = false;

    // --- UI State Management ---
    function setRespondingState(responding) {
        isResponding = responding;
        messageInput.disabled = responding;
        sendBtn.style.display = responding ? 'none' : 'flex';
        stopBtn.style.display = responding ? 'flex' : 'none';
        internetSearchToggle.disabled = responding;
    }

    function createChatElement(chat) {
        const chatElement = document.createElement('div');
        chatElement.classList.add('chat-item');
        chatElement.dataset.chatId = chat.id;
        chatElement.textContent = chat.title;
        chatElement.addEventListener('click', () => {
            if (isResponding) return;
            currentChatId = chat.id;
            currentResponseContent = '';
            chatWindow.innerHTML = '';
            socket.emit('get_history', { userId, chatId: chat.id });
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            chatElement.classList.add('active');
        });
        return chatElement;
    }

    function appendMessage(sender, text, isStreaming = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);
        if (isStreaming) {
            messageElement.classList.add('streaming');
        }
        
        const contentElement = document.createElement('div');
        if (sender === 'assistant') {
            contentElement.innerHTML = converter.makeHtml(text);
        } else {
            contentElement.textContent = text;
        }
        messageElement.appendChild(contentElement);
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && !isResponding) {
            appendMessage('user', message);
            setRespondingState(true);
            socket.emit('message', { 
                userId, 
                chatId: currentChatId, 
                message,
                useInternet: internetSearchToggle.checked
            });
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
    }

    // --- Event Listeners ---
    sendBtn.addEventListener('click', sendMessage);

    stopBtn.addEventListener('click', () => {
        if (isResponding) {
            socket.emit('stop_generation', { userId, chatId: currentChatId });
        }
    });

    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
    
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });

    newChatBtn.addEventListener('click', () => {
        if (isResponding) return;
        socket.emit('new_chat', { userId });
    });

    // --- Socket.IO Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('get_chats', { userId });
    });

    socket.on('chat_list', (data) => {
        chatList.innerHTML = '';
        data.chats.forEach(chat => {
            chatList.appendChild(createChatElement(chat));
        });
        if (!currentChatId && data.chats.length > 0) {
            chatList.children[0].click();
        } else if (currentChatId) {
            const activeChat = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
            if(activeChat) activeChat.classList.add('active');
        }
    });

    socket.on('chat_created', (data) => {
        const chatElement = createChatElement(data);
        chatList.prepend(chatElement);
        currentResponseContent = '';
        chatElement.click();
    });

    socket.on('chat_history', (data) => {
        chatWindow.innerHTML = '';
        data.history.forEach(message => {
            appendMessage(message.role, message.content);
        });
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) return;

        if (data.first_chunk) {
            currentResponseContent = '';
            appendMessage('assistant', '...', true);
        }
        
        const lastMessage = chatWindow.querySelector('.message.assistant.streaming div');
        if (lastMessage) {
            currentResponseContent += data.content;
            lastMessage.innerHTML = converter.makeHtml(currentResponseContent);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });

    socket.on('response_end', (data) => {
        if (data.chatId === currentChatId) {
            const lastMessage = chatWindow.querySelector('.message.assistant.streaming');
            if(lastMessage) lastMessage.classList.remove('streaming');
            setRespondingState(false);
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