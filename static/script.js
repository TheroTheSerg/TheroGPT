document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
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

    function createChatElement(chat) {
        const chatElement = document.createElement('div');
        chatElement.classList.add('chat-item');
        chatElement.dataset.chatId = chat.id;
        chatElement.textContent = chat.title;
        chatElement.addEventListener('click', () => {
            currentChatId = chat.id;
            currentResponseContent = ''; // Reset content buffer
            chatWindow.innerHTML = '';
            socket.emit('get_history', { userId, chatId: chat.id });
        });
        return chatElement;
    }

    function appendMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);
        if (sender === 'assistant') {
            messageElement.innerHTML = converter.makeHtml(text);
        } else {
            messageElement.textContent = text;
        }
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function sendMessage() {
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
            messageInput.style.height = 'auto'; // Reset height after sending
        }
    }

    sendBtn.addEventListener('click', sendMessage);

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
        if (!currentChatId && data.chats.length > 0) {
            data.chats[0] && chatList.children[0].click();
        }
    });

    socket.on('chat_created', (data) => {
        const chatElement = createChatElement(data);
        chatList.prepend(chatElement);
        currentResponseContent = ''; // Reset content buffer
        chatElement.click();
    });

    socket.on('chat_history', (data) => {
        chatWindow.innerHTML = '';
        data.history.forEach(message => {
            appendMessage(message.role, message.content);
        });
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) {
            return; // Ignore responses for non-active chats
        }

        if (data.first_chunk) {
            currentResponseContent = ''; // Reset for a new response
            const assistantMessage = document.createElement('div');
            assistantMessage.classList.add('message', 'assistant');
            chatWindow.appendChild(assistantMessage);
        }
        
        const lastMessage = chatWindow.querySelector('.message.assistant:last-child');
        if (lastMessage) {
            currentResponseContent += data.content;
            lastMessage.innerHTML = converter.makeHtml(currentResponseContent);
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