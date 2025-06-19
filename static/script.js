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

    // --- Core & Helper Functions ---
    const addMessage = (text, type) => {
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble', `${type}-message`);
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        scrollToBottom();
        return bubble;
    };

    const scrollToBottom = () => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    const showTypingIndicator = (show) => {
        typingIndicator.style.display = show ? 'flex' : 'none';
    };

    const typeWriter = () => {
        if (isTyping || chunkQueue.length === 0) return;
        isTyping = true;
        const chunk = chunkQueue.shift();
        let i = 0;
        const type = () => {
            if (i < chunk.length) {
                currentAiBubble.textContent += chunk.charAt(i);
                i++;
                scrollToBottom();
                setTimeout(type, TYPING_SPEED);
            } else {
                isTyping = false;
                typeWriter();
            }
        };
        type();
    };

    // --- Chat Management ---
    const addChatItemToSidebar = (chat, prepend = false) => {
        const listItem = document.createElement('li');
        listItem.dataset.chatId = chat.id;
        listItem.classList.add('chat-list-item');
        const chatLink = document.createElement('a');
        chatLink.href = '#';
        chatLink.textContent = chat.title;
        listItem.appendChild(chatLink);
        const deleteButton = document.createElement('button');
        deleteButton.innerHTML = '&times;';
        deleteButton.classList.add('delete-chat-button');
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete "${chat.title}"?`)) {
                socket.emit('delete_chat', { userId, chatId: chat.id });
            }
        };
        listItem.appendChild(deleteButton);
        listItem.addEventListener('click', () => switchChat(chat.id));
        if (prepend) chatList.prepend(listItem);
        else chatList.appendChild(listItem);
    };

    const renderChatList = (chats) => {
        chatList.innerHTML = '';
        chats.forEach(chat => addChatItemToSidebar(chat));
    };

    const switchChat = (chatId) => {
        if (chatId === currentChatId) return;
        currentChatId = chatId;
        chatContainer.innerHTML = '';
        currentAiBubble = null;
        showTypingIndicator(false);
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
        const activeChatEl = document.querySelector(`#chat-list li[data-chat-id="${chatId}"] a`);
        chatTitle.textContent = activeChatEl ? activeChatEl.textContent : "Loading...";
        socket.emit('get_history', { userId, chatId });
    };

    // --- Event Listeners ---
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!currentChatId) return alert("Please select a chat first.");
        if (message) {
            addMessage(message, 'user');
            socket.emit('message', { userId, chatId: currentChatId, message });
            messageInput.value = '';
            showTypingIndicator(true);
            currentAiBubble = null;
        }
    });

    newChatButton.addEventListener('click', () => socket.emit('new_chat', { userId }));

    // --- Socket.IO Handlers ---
    socket.on('connect', () => socket.emit('get_chats', { userId }));
    socket.on('chat_list', (data) => {
        renderChatList(data.chats);
        if (data.chats.length > 0 && !currentChatId) {
            switchChat(data.chats[0].id);
        } else if (data.chats.length === 0) {
            socket.emit('new_chat', { userId });
        }
    });
    socket.on('chat_history', (data) => {
        if (data.chatId !== currentChatId) return;
        chatContainer.innerHTML = '';
        data.history.forEach(msg => addMessage(msg.content, msg.role));
    });
    socket.on('chat_created', (chat) => {
        addChatItemToSidebar(chat, true);
        switchChat(chat.id);
    });
    socket.on('chat_deleted', (data) => {
        document.querySelector(`li[data-chat-id="${data.chatId}"]`)?.remove();
        if (currentChatId === data.chatId) {
            currentChatId = null;
            const firstChat = chatList.querySelector('li');
            if (firstChat) switchChat(firstChat.dataset.chatId);
            else socket.emit('new_chat', { userId });
        }
    });
    socket.on('chat_title_updated', (data) => {
        const chatItem = document.querySelector(`li[data-chat-id="${data.chatId}"] a`);
        if (chatItem) chatItem.textContent = data.title;
        if (data.chatId === currentChatId) chatTitle.textContent = data.title;
    });
    socket.on('response', (data) => {
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
        showTypingIndicator(false);
        addMessage(data.error, 'error');
    });
});