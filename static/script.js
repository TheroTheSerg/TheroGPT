document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Initializing script.");

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
        console.log("No userId found. Generated new one:", userId);
    } else {
        console.log("Found existing userId:", userId);
    }

    let currentChatId = null;
    let currentAiBubble = null;

    // --- Chat Management Functions ---
    const addChatItemToSidebar = (chat, prepend = false) => {
        console.log("Adding chat to sidebar:", chat);
        const listItem = document.createElement('li');
        listItem.dataset.chatId = chat.id;
        listItem.classList.add('chat-list-item');

        const chatLink = document.createElement('a');
        chatLink.href = '#';
        chatLink.textContent = chat.title;
        listItem.appendChild(chatLink);

        const deleteButton = document.createElement('button');
        deleteButton.textContent = '×';
        deleteButton.classList.add('delete-chat-button');
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete chat "${chat.title}"?`)) {
                socket.emit('delete_chat', { userId, chatId: chat.id });
            }
        };
        listItem.appendChild(deleteButton);
        
        listItem.addEventListener('click', () => switchChat(chat.id));

        if (prepend) chatList.prepend(listItem);
        else chatList.appendChild(listItem);
    };

    const renderChatList = (chats) => {
        console.log("Rendering chat list with", chats.length, "chats.");
        chatList.innerHTML = '';
        chats.forEach(chat => addChatItemToSidebar(chat));
    };

    const switchChat = (chatId) => {
        console.log(`Switching to chat: ${chatId}. Current chat is: ${currentChatId}`);
        if (chatId === currentChatId) {
            console.log("Already on this chat. Aborting switch.");
            return;
        }
        
        currentChatId = chatId;
        chatContainer.innerHTML = '';
        currentAiBubble = null;
        showTypingIndicator(false);
        
        document.querySelectorAll('#chat-list li').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === currentChatId);
        });
        
        const activeChatEl = document.querySelector(`#chat-list li[data-chat-id="${chatId}"] a`);
        chatTitle.textContent = activeChatEl ? activeChatEl.textContent : "Loading Chat...";
        
        console.log(`Emitting 'get_history' for chat: ${chatId}`);
        socket.emit('get_history', { userId, chatId });
    };

    const addMessage = (text, type) => {
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble', `${type}-message`);
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        scrollToBottom();
        return bubble;
    };

    const showTypingIndicator = (show) => {
        typingIndicator.style.display = show ? 'flex' : 'none';
    };

    const scrollToBottom = () => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    // --- Event Listeners ---
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        console.log("Form submitted. Message:", message, "Chat ID:", currentChatId);

        if (!currentChatId) {
            alert("Please select a chat first.");
            return;
        }
        if (message) {
            addMessage(message, 'user');
            socket.emit('message', { userId, chatId: currentChatId, message });
            messageInput.value = '';
            showTypingIndicator(true);
            currentAiBubble = null;
        }
    });

    newChatButton.addEventListener('click', () => {
        console.log("New chat button clicked.");
        socket.emit('new_chat', { userId });
    });

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log("--- Socket connected! Emitting 'get_chats'. ---");
        socket.emit('get_chats', { userId });
    });

    socket.on('chat_list', (data) => {
        console.log("<-- Received 'chat_list':", data.chats);
        renderChatList(data.chats);
        if (data.chats.length > 0) {
            if (!currentChatId) {
                switchChat(data.chats[0].id);
            }
        } else {
            console.log("Chat list is empty. Requesting a new chat.");
            socket.emit('new_chat', { userId });
        }
    });
    
    socket.on('chat_history', (data) => {
        console.log("<-- Received 'chat_history' for chat:", data.chatId);
        if (data.chatId !== currentChatId) return;
        chatContainer.innerHTML = '';
        data.history.forEach(msg => addMessage(msg.content, msg.role));
        scrollToBottom();
    });
    
    socket.on('chat_created', (chat) => {
        console.log("<-- Received 'chat_created':", chat);
        addChatItemToSidebar(chat, true);
        switchChat(chat.id);
    });

    socket.on('chat_deleted', (data) => {
        console.log("<-- Received 'chat_deleted':", data.chatId);
        const itemToDelete = document.querySelector(`li[data-chat-id="${data.chatId}"]`);
        if (itemToDelete) itemToDelete.remove();
        
        if (currentChatId === data.chatId) {
            currentChatId = null;
            const firstChat = chatList.querySelector('li');
            if (firstChat) switchChat(firstChat.dataset.chatId);
            else socket.emit('new_chat', { userId });
        }
    });

    socket.on('chat_title_updated', (data) => {
        console.log("<-- Received 'chat_title_updated':", data);
        const chatItem = document.querySelector(`li[data-chat-id="${data.chatId}"] a`);
        if (chatItem) chatItem.textContent = data.title;
        if (data.chatId === currentChatId) chatTitle.textContent = data.title;
    });

    socket.on('response', (data) => {
        if (data.chatId !== currentChatId) return;
        showTypingIndicator(false);

        if (!currentAiBubble) {
            currentAiBubble = addMessage('', 'ai');
        }
        currentAiBubble.textContent += data.content;
        scrollToBottom();
    });

    socket.on('response_error', (data) => {
        console.error("<-- Received 'response_error':", data);
        if (data.chatId !== currentChatId) return;
        showTypingIndicator(false);
        addMessage(data.error, 'error');
    });
});