let currentColumn;
let currentBoardId;
let currentTaskFiles = [];
const DEFAULT_COLUMNS = [
    { id: 'todo', title: 'К выполнению', isDefault: true },
    { id: 'in-progress', title: 'В процессе', isDefault: true },
    { id: 'done', title: 'Готово', isDefault: true }
];

// Добавляем переменные для работы с IndexedDB
const DB_NAME = 'KanbanDB';
const DB_VERSION = 1;
let db;

// Добавляем переменные для редактирования
let editingTaskId = null;
let editingTaskFiles = [];
let currentEditingTaskId = null;

let telegramWebApp;
let currentUser;

// Инициализация IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files', { keyPath: 'id' });
            }
        };
    });
}

// Модифицируем обработчик загрузки страницы
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initializeStorage();
    loadBoards();
    loadLastBoard();
    initTelegramApp();
    initApp();
});

// Функция сохранения файла в IndexedDB
async function saveFileToIndexedDB(file) {
    return new Promise((resolve, reject) => {
        const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const transaction = db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');

        const request = store.put({
            id: fileId,
            name: file.name,
            type: file.type,
            size: file.size,
            data: file
        });

        request.onsuccess = () => resolve(fileId);
        request.onerror = () => reject(request.error);
    });
}

// Функция получения файла из IndexedDB
async function getFileFromIndexedDB(fileId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(fileId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Функция создания начальной структуры
function initializeStorage() {
    if (!localStorage.getItem('kanbanBoards')) {
        const initialBoard = {
            ['board-' + Date.now()]: {
                title: 'Моя первая доска',
                columns: [...DEFAULT_COLUMNS],
                tasks: {
                    'todo': [],
                    'in-progress': [],
                    'done': []
                }
            }
        };
        localStorage.setItem('kanbanBoards', JSON.stringify(initialBoard));
    }
}

// Функции для работы с досками
function showBoardForm() {
    document.getElementById('board-form').style.display = 'block';
}

function closeBoardForm() {
    document.getElementById('board-form').style.display = 'none';
    document.getElementById('board-title').value = '';
}

// Изменяем функцию addBoard
async function createBoard() {
    console.log('Вызвана функция createBoard');
    
    if (!currentUser) {
        console.error('Пользователь не авторизован');
        return;
    }

    const boardName = prompt('Введите название доски:');
    if (!boardName || boardName.trim() === '') {
        return;
    }

    try {
        const boardId = 'board-' + Date.now();
        const existingBoards = getBoards();
        
        const newBoard = {
            id: boardId,
            name: boardName,
            owner: currentUser.id,
            tasks: {},
            columns: [
                { id: `column-${boardId}-1`, title: 'К выполнению' },
                { id: `column-${boardId}-2`, title: 'В процессе' },
                { id: `column-${boardId}-3`, title: 'Готово' }
            ]
        };

        // Инициализируем tasks
        newBoard.columns.forEach(column => {
            newBoard.tasks[column.id] = [];
        });

        // Сохраняем
        existingBoards[boardId] = newBoard;
        saveBoards(existingBoards);
        
        console.log('Создана новая доска:', newBoard);

        // Обновляем интерфейс
        currentBoardId = boardId;
        updateBoardSelect();
        displayBoard(boardId);

        return boardId;
    } catch (error) {
        console.error('Ошибка при создании доски:', error);
        alert('Произошла ошибка при создании доски');
        return null;
    }
}

// Изменяем функцию получения досок
function getBoards() {
    if (!currentUser) {
        console.error('Пользователь не авторизован при попытке получения досок');
        return {};
    }
    
    const userId = currentUser.id;
    try {
        const userBoards = localStorage.getItem(`kanban_boards_${userId}`);
        const boards = userBoards ? JSON.parse(userBoards) : {};
        console.log(`Получены доски для пользователя ${userId}:`, boards);
        return boards;
    } catch (error) {
        console.error('Ошибка при получении досок:', error);
        return {};
    }
}

// Модифицируем функцию loadBoards
function loadBoards() {
    const boards = getBoards();
    const select = document.getElementById('board-select');
    select.innerHTML = '';
    
    // Если нет досок, создаем дефолтную
    if (Object.keys(boards).length === 0) {
        const defaultBoardId = 'board-' + Date.now();
        boards[defaultBoardId] = {
            title: 'Моя первая доска',
            columns: [...DEFAULT_COLUMNS],
            tasks: {
                'todo': [],
                'in-progress': [],
                'done': []
            }
        };
        localStorage.setItem('kanbanBoards', JSON.stringify(boards));
        currentBoardId = defaultBoardId;
    }
    
    Object.entries(boards).forEach(([id, board]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = board.title;
        if (id === currentBoardId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// Модифицируем функцию loadLastBoard
function loadLastBoard() {
    const lastBoardId = localStorage.getItem('lastBoardId');
    const boards = getBoards();
    
    // Если нет последней доски или она была удалена, берем первую доступную
    if (!lastBoardId || !boards[lastBoardId]) {
        const firstBoardId = Object.keys(boards)[0];
        if (firstBoardId) {
            switchBoard(firstBoardId);
        }
    } else {
        switchBoard(lastBoardId);
    }
}

// Модифицируем функцию switchBoard
function switchBoard(boardId) {
    if (!boardId || boardId === '' || typeof boardId !== 'string') {
        console.error('Некорректный ID доски для переключения:', boardId);
        return;
    }

    const boards = getBoards();
    if (!boards[boardId]) {
        console.error('Доска не найдена:', boardId);
        return;
    }

    console.log('Переключение на доску:', boardId);
    currentBoardId = boardId;
    displayBoard(boardId);
}

// Функции для работы со столбцами
function showColumnForm() {
    document.getElementById('column-form').style.display = 'block';
}

function closeColumnForm() {
    document.getElementById('column-form').style.display = 'none';
    document.getElementById('column-title').value = '';
}

function addColumn() {
    const title = document.getElementById('column-title').value.trim();
    if (!title) return;

    const boards = getBoards();
    const board = boards[currentBoardId];
    
    const columnId = 'column-' + Date.now();
    
    // Добавляем новый столбец в конец списка
    board.columns.push({
        id: columnId,
        title: title,
        isDefault: false
    });
    
    // Инициализируем массив задач для нового столбца
    board.tasks[columnId] = [];
    
    localStorage.setItem('kanbanBoards', JSON.stringify(boards));
    closeColumnForm();
    renderBoard(board);
}

function deleteColumnConfirm(columnId) {
    const boards = getBoards();
    const board = boards[currentBoardId];
    const column = board.columns.find(col => col.id === columnId);

    if (column.isDefault) {
        alert('Нельзя удалить стандартный столбец');
        return;
    }

    if (confirm(`Вы действительно хотите удалить столбец "${column.title}"? Все задачи будут удалены безвозвратно.`)) {
        deleteColumn(columnId);
    }
}

async function deleteColumn(columnId) {
    const boards = getBoards();
    const board = boards[currentBoardId];

    // Удаляем файлы задач столбца
    const tasks = board.tasks[columnId] || [];
    for (const task of tasks) {
        if (task.files) {
            for (const file of task.files) {
                try {
                    const transaction = db.transaction(['files'], 'readwrite');
                    const store = transaction.objectStore('files');
                    await store.delete(file.id);
                } catch (error) {
                    console.error('Ошибка при удалении файла:', error);
                }
            }
        }
    }

    // Удаляем столбец и его задачи
    board.columns = board.columns.filter(col => col.id !== columnId);
    delete board.tasks[columnId];

    localStorage.setItem('kanbanBoards', JSON.stringify(boards));
    renderBoard(board);
}

// Добавляем функцию редактирования названия столбца
function editColumnTitle(columnId) {
    const boards = getBoards();
    const board = boards[currentBoardId];
    const column = board.columns.find(col => col.id === columnId);
    
    const newTitle = prompt('Введите новое название столбца:', column.title);
    if (newTitle && newTitle.trim()) {
        column.title = newTitle.trim();
        localStorage.setItem('kanbanBoards', JSON.stringify(boards));
        renderBoard(board);
    }
}

// Функция рендеринга доски
function renderBoard(boardId) {
    if (typeof boardId !== 'string') {
        console.error('Некорректный тип boardId:', typeof boardId);
        return;
    }

    console.log('Отображение доски:', boardId);
    const boards = getBoards();
    const board = boards[boardId];

    if (!board) {
        console.error('Доска не найдена:', boardId);
        return;
    }

    const kanbanContainer = document.querySelector('.kanban');
    kanbanContainer.innerHTML = '';

    board.columns.forEach(column => {
        const columnHTML = `
            <div class="column" id="${column.id}">
                <h2>${column.title}</h2>
                <div class="tasks" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
            </div>
        `;
        kanbanContainer.insertAdjacentHTML('beforeend', columnHTML);

        // Загружаем задачи для колонки
        const tasks = loadBoardTasks(boardId, column.id);
        const tasksContainer = document.querySelector(`#${column.id} .tasks`);
        
        if (Array.isArray(tasks)) {
            tasks.forEach(task => {
                if (task) {
                    const taskElement = createTaskElement(task);
                    tasksContainer.appendChild(taskElement);
                }
            });
        }
    });

    // Обновляем select
    const select = document.getElementById('board-select');
    if (select) {
        select.value = boardId;
    }
}

// Обновляем функцию loadBoardTasks
function loadBoardTasks(boardId, columnId) {
    if (typeof boardId !== 'string') {
        console.error('boardId должен быть строкой:', boardId);
        return [];
    }

    if (!boardId || !columnId) {
        console.error('Отсутствуют необходимые параметры:', { boardId, columnId });
        return [];
    }

    const boards = getBoards();
    const board = boards[boardId];

    if (!board) {
        console.error('Доска не найдена:', boardId);
        return [];
    }

    if (!board.tasks) {
        board.tasks = {};
    }

    if (!board.tasks[columnId]) {
        board.tasks[columnId] = [];
    }

    return board.tasks[columnId];
}

// Функции для drag and drop
function allowDrop(ev) {
    ev.preventDefault();
}

function drag(ev) {
    ev.dataTransfer.setData("text", ev.target.id);
}

function drop(ev) {
    ev.preventDefault();
    const taskId = ev.dataTransfer.getData("text");
    const taskElement = document.getElementById(taskId);
    const dropZone = ev.target.closest('.tasks');
    
    if (dropZone) {
        dropZone.appendChild(taskElement);
        saveTasks();
    }
}

// Показать форму добавления задачи
function showForm(columnId) {
    currentColumn = columnId;
    document.getElementById('task-form').style.display = 'block';
}

// Закрыть форму
function closeForm() {
    document.getElementById('task-form').style.display = 'none';
    document.getElementById('task-title').value = '';
    document.getElementById('task-description').value = '';
    document.getElementById('task-files').value = '';
    document.getElementById('file-list').innerHTML = '';
    currentTaskFiles = [];
}

// Добавить новую задачу
async function addTask() {
    if (!currentBoardId) {
        alert('Пожалуйста, создайте или выберите доску');
        return;
    }

    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    
    if (title.trim() === '') return;

    const taskId = 'task-' + Date.now();
    const taskHTML = `
        <div class="task" id="${taskId}" draggable="true" ondragstart="drag(event)">
            <button class="delete-btn" onclick="deleteTask(event)">×</button>
            <button class="edit-btn" onclick="openEditForm('${taskId}')">✎</button>
            <h3>${title}</h3>
            <p>${description}</p>
            ${currentTaskFiles.length > 0 ? '<div class="task-files"></div>' : ''}
        </div>
    `;

    // Добавляем задачу в первый столбец, если не указан конкретный
    const boards = getBoards();
    const board = boards[currentBoardId];
    const columnId = currentColumn || board.columns[0].id;
    
    document.querySelector(`#${columnId} .tasks`).insertAdjacentHTML('beforeend', taskHTML);
    
    if (currentTaskFiles.length > 0) {
        const taskElement = document.getElementById(taskId);
        const filesContainer = taskElement.querySelector('.task-files');
        
        for (const fileInfo of currentTaskFiles) {
            const fileElement = document.createElement('div');
            fileElement.className = 'task-file';
            fileElement.innerHTML = `
                <a href="#" data-file-id="${fileInfo.id}" onclick="downloadFile('${fileInfo.id}', '${fileInfo.name}'); return false;">
                    ${fileInfo.name.length > 20 ? fileInfo.name.substring(0, 20) + '...' : fileInfo.name}
                </a>
                <span class="file-size">${formatFileSize(fileInfo.size)}</span>
            `;
            filesContainer.appendChild(fileElement);
        }
    }

    closeForm();
    saveTasks();
}

// Модифицируем функцию deleteTask
async function deleteTask(event) {
    event.stopPropagation();
    const task = event.target.closest('.task');
    
    if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
        // Удаляем файлы задачи из IndexedDB
        const fileLinks = task.querySelectorAll('.task-file a');
        for (const link of fileLinks) {
            const fileId = link.dataset.fileId;
            if (fileId) {
                try {
                    const transaction = db.transaction(['files'], 'readwrite');
                    const store = transaction.objectStore('files');
                    await store.delete(fileId);
                } catch (error) {
                    console.error('Ошибка при удалении файла:', error);
                }
            }
        }
        
        task.remove();
        saveTasks();
    }
}

// Модифицируем функцию saveTasks
function saveTasks() {
    const boards = getBoards();
    const board = boards[currentBoardId];
    const tasks = {};

    board.columns.forEach(column => {
        const columnTasks = [];
        document.querySelectorAll(`#${column.id} .task`).forEach(task => {
            const filesData = [];
            task.querySelectorAll('.task-file a').forEach(fileLink => {
                filesData.push({
                    id: fileLink.dataset.fileId,
                    name: fileLink.textContent.trim(),
                    size: fileLink.nextElementSibling.textContent
                });
            });

            columnTasks.push({
                id: task.id,
                title: task.querySelector('h3').innerText,
                description: task.querySelector('p').innerText,
                files: filesData
            });
        });
        tasks[column.id] = columnTasks;
    });

    board.tasks = tasks;
    localStorage.setItem('kanbanBoards', JSON.stringify(boards));
}

// Функция обработки выбора файлов
async function handleFileSelect(event) {
    const files = event.target.files;
    const fileList = document.getElementById('file-list');
    
    for (const file of files) {
        try {
            const fileId = await saveFileToIndexedDB(file);
            currentTaskFiles.push({
                id: fileId,
                name: file.name,
                type: file.type,
                size: file.size
            });
            
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                ${file.name}
                <span class="file-size">(${formatFileSize(file.size)})</span>
                <button onclick="removeFile('${fileId}')">×</button>
            `;
            fileList.appendChild(fileItem);
        } catch (error) {
            console.error('Ошибка при сохранении файла:', error);
            alert(`Ошибка при сохранении файла ${file.name}`);
        }
    }
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Удаление файла из списка
function removeFile(fileName) {
    currentTaskFiles = currentTaskFiles.filter(file => file.name !== fileName);
    updateFileList();
}

// Обновление списка файлов
function updateFileList() {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    currentTaskFiles.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            ${file.name}
            <span class="file-size">(${formatFileSize(file.size)})</span>
            <button onclick="removeFile('${file.name}')">×</button>
        `;
        fileList.appendChild(fileItem);
    });
}

// Добавляем функцию для скачивания файла
async function downloadFile(fileId, fileName) {
    try {
        const fileData = await getFileFromIndexedDB(fileId);
        const blob = fileData.data;
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Ошибка при скачивании файла:', error);
        alert('Ошибка при скачивании файла');
    }
}

// Добавляем функцию подтверждения удаления доски
function deleteBoardConfirm() {
    if (!currentBoardId) {
        alert('Не выбрана доска для удаления');
        return;
    }

    const boards = getBoards();
    const boardTitle = boards[currentBoardId].title;

    if (Object.keys(boards).length === 1) {
        alert('Нельзя удалить единственную доску');
        return;
    }

    if (confirm(`Вы действительно хотите удалить доску "${boardTitle}"? Все задачи будут удалены безвозвратно.`)) {
        deleteBoard(currentBoardId);
    }
}

// Функция удаления доски
async function deleteBoard(boardId) {
    try {
        const boards = getBoards();
        
        // Удаляем все файлы, связанные с задачами этой доски
        await deleteAllBoardFiles(boards[boardId]);
        
        // Удаляем доску из хранилища
        delete boards[boardId];
        localStorage.setItem('kanbanBoards', JSON.stringify(boards));

        // Если удалили текущую доску, переключаемся на первую доступную
        if (boardId === currentBoardId) {
            const firstBoardId = Object.keys(boards)[0];
            currentBoardId = firstBoardId;
            localStorage.setItem('lastBoardId', firstBoardId);
        }

        // Перезагружаем список досок и отображение
        loadBoards();
        switchBoard(currentBoardId);
    } catch (error) {
        console.error('Ошибка при удалении доски:', error);
        alert('Произошла ошибка при удалении доски');
    }
}

// Функция удаления всех файлов доски
async function deleteAllBoardFiles(board) {
    const fileIds = new Set();
    
    // Собираем все ID файлов из всех задач
    Object.values(board.tasks).forEach(columnTasks => {
        columnTasks.forEach(task => {
            if (task.files) {
                task.files.forEach(file => {
                    if (file.id) fileIds.add(file.id);
                });
            }
        });
    });

    // Удаляем файлы из IndexedDB
    const promises = Array.from(fileIds).map(fileId => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.delete(fileId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    });

    await Promise.all(promises);
}

// Функция открытия формы редактирования
function openEditForm(taskId) {
    const task = document.getElementById(taskId);
    const title = task.querySelector('h3').textContent;
    const description = task.querySelector('p').textContent;
    
    document.getElementById('edit-task-title').value = title;
    document.getElementById('edit-task-description').value = description;
    currentEditingTaskId = taskId;
    
    document.getElementById('edit-task-form').style.display = 'block';
}

// Функция закрытия формы редактирования
function closeEditForm() {
    document.getElementById('edit-task-form').style.display = 'none';
    document.getElementById('edit-file-list').innerHTML = '';
    currentEditingTaskId = null;
}

// Функция сохранения изменений
function saveTaskEdit() {
    if (!currentEditingTaskId) return;
    
    const task = document.getElementById(currentEditingTaskId);
    const newTitle = document.getElementById('edit-task-title').value;
    const newDescription = document.getElementById('edit-task-description').value;
    
    if (newTitle.trim() === '') return;
    
    task.querySelector('h3').textContent = newTitle;
    task.querySelector('p').textContent = newDescription;
    
    closeEditForm();
}

// Инициализация Telegram Web App
function initTelegramApp() {
    try {
        telegramWebApp = window.Telegram.WebApp;
        telegramWebApp.ready();
        
        // Проверяем, есть ли данные пользователя
        if (telegramWebApp.initDataUnsafe && telegramWebApp.initDataUnsafe.user) {
            currentUser = telegramWebApp.initDataUnsafe.user;
            console.log('Пользователь авторизован:', currentUser);
        } else {
            // Если нет данных из Telegram, создаем временного пользователя для тестирования
            currentUser = {
                id: 'test_user_' + Date.now(),
                first_name: 'Тестовый пользователь'
            };
            console.log('Создан тестовый пользователь:', currentUser);
        }
        
        loadUserBoards();
    } catch (error) {
        console.error('Ошибка при инициализации:', error);
        // Создаем временного пользователя в случае ошибки
        currentUser = {
            id: 'test_user_' + Date.now(),
            first_name: 'Тестовый пользователь'
        };
        loadUserBoards();
    }
}

// Изменяем функцию сохранения досок
function saveBoards(boards) {
    if (!currentUser) {
        console.error('Пользователь не авторизован при попытке сохранения досок');
        return;
    }
    
    const userId = currentUser.id;
    try {
        localStorage.setItem(`kanban_boards_${userId}`, JSON.stringify(boards));
        console.log(`Сохранены доски для пользователя ${userId}:`, boards);
    } catch (error) {
        console.error('Ошибка при сохранении досок:', error);
    }
}

// Добавляем функцию создания доски по умолчанию
function createDefaultBoard() {
    const defaultBoard = {
        id: 'board-' + Date.now(),
        name: 'Моя первая доска',
        owner: currentUser.id,
        columns: [
            {
                id: 'column-' + Date.now(),
                title: 'К выполнению'
            },
            {
                id: 'column-' + (Date.now() + 1),
                title: 'В процессе'
            },
            {
                id: 'column-' + (Date.now() + 2),
                title: 'Готово'
            }
        ]
    };

    const boards = {};
    boards[defaultBoard.id] = defaultBoard;
    saveBoards(boards);
    return defaultBoard.id;
}

// Обновляем функцию loadUserBoards
function loadUserBoards() {
    console.log('Загрузка досок для пользователя:', currentUser);
    
    let boards = getBoards();
    console.log('Текущие доски:', boards);

    // Если досок нет, создаем доску по умолчанию
    if (Object.keys(boards).length === 0) {
        console.log('Создание доски по умолчанию...');
        const defaultBoardId = createDefaultBoard();
        boards = getBoards();
        currentBoardId = defaultBoardId;
        console.log('Создана доска по умолчанию:', defaultBoardId);
    }

    updateBoardSelect();

    // Если есть текущая доска, отображаем её
    if (currentBoardId && boards[currentBoardId]) {
        displayBoard(currentBoardId);
    } else if (Object.keys(boards).length > 0) {
        // Если нет текущей доски, но есть другие доски, отображаем первую
        currentBoardId = Object.keys(boards)[0];
        displayBoard(currentBoardId);
    }
}

// Обновляем функцию updateBoardSelect
function updateBoardSelect() {
    const select = document.getElementById('board-select');
    if (!select) return;

    const boards = getBoards();
    console.log('Обновление списка досок:', boards);
    
    // Сохраняем текущее значение
    const currentValue = select.value;
    
    // Очищаем select
    select.innerHTML = '';
    
    // Добавляем опции
    Object.entries(boards).forEach(([id, board]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = board.name;
        select.appendChild(option);
    });
    
    // Восстанавливаем выбранное значение
    if (currentBoardId && boards[currentBoardId]) {
        select.value = currentBoardId;
    } else if (currentValue && boards[currentValue]) {
        select.value = currentValue;
    }
}

// Добавляем функцию очистки при выходе
function clearCurrentBoardData() {
    currentBoardId = null;
    currentColumn = null;
    document.querySelector('.kanban').innerHTML = '';
}

// Обновляем функцию initApp
function initApp() {
    console.log('Инициализация приложения...');
    
    // Удаляем и переустанавливаем обработчик кнопки создания доски
    const createBtn = document.getElementById('create-board-btn');
    if (createBtn) {
        // Удаляем все существующие обработчики
        const newBtn = createBtn.cloneNode(true);
        createBtn.parentNode.replaceChild(newBtn, createBtn);
        
        // Добавляем единственный обработчик
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            createBoard();
        });
    }

    // Инициализация select
    const select = document.getElementById('board-select');
    if (select) {
        const newSelect = select.cloneNode(true);
        select.parentNode.replaceChild(newSelect, select);
        
        newSelect.addEventListener('change', function(event) {
            event.preventDefault();
            event.stopPropagation();
            
            const selectedId = this.value;
            if (selectedId && selectedId !== '') {
                currentBoardId = selectedId;
                displayBoard(selectedId);
            }
        });
    }
}

// Обновляем функцию displayBoard
function displayBoard(boardId) {
    console.log('Отображение доски:', boardId);
    
    if (!boardId || typeof boardId !== 'string') {
        console.error('Некорректный ID доски:', boardId);
        return;
    }

    const boards = getBoards();
    const board = boards[boardId];
    
    if (!board) {
        console.error('Доска не найдена:', boardId);
        return;
    }

    // Обновляем select
    const select = document.getElementById('board-select');
    if (select && select.value !== boardId) {
        select.value = boardId;
    }

    // Очищаем и обновляем контейнер
    const kanbanContainer = document.querySelector('.kanban');
    kanbanContainer.innerHTML = '';
    
    // Отображаем колонки
    board.columns.forEach(column => {
        const columnHTML = `
            <div class="column" id="${column.id}">
                <h2>${column.title}</h2>
                <div class="tasks" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
            </div>
        `;
        kanbanContainer.insertAdjacentHTML('beforeend', columnHTML);
        
        // Загружаем задачи
        if (board.tasks && board.tasks[column.id]) {
            const tasks = board.tasks[column.id];
            const tasksContainer = document.querySelector(`#${column.id} .tasks`);
            
            tasks.forEach(task => {
                if (task) {
                    const taskElement = createTaskElement(task);
                    tasksContainer.appendChild(taskElement);
                }
            });
        }
    });

    // Сохраняем текущий ID доски
    currentBoardId = boardId;
    console.log('Доска отображена:', boardId);
}

// Добавляем вспомогательную функцию создания элемента задачи
function createTaskElement(task) {
    const div = document.createElement('div');
    div.className = 'task';
    div.id = task.id;
    div.draggable = true;
    div.ondragstart = drag;
    
    div.innerHTML = `
        <button class="delete-btn" onclick="deleteTask(event)">×</button>
        <button class="edit-btn" onclick="openEditForm('${task.id}')">✎</button>
        <h3>${task.title}</h3>
        <p>${task.description}</p>
        ${task.files && task.files.length > 0 ? '<div class="task-files"></div>' : ''}
    `;
    
    return div;
}

// Добавляем функцию для проверки состояния
function debugState() {
    const boards = getBoards();
    console.log('=== Текущее состояние ===');
    console.log('Текущий пользователь:', currentUser);
    console.log('Текущая доска:', currentBoardId);
    console.log('Доски в хранилище:', boards);
    if (currentBoardId) {
        console.log('Текущая доска существует:', !!boards[currentBoardId]);
    }
}