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

// Модифицируем функцию addBoard
function addBoard() {
    const title = document.getElementById('board-title').value.trim();
    if (!title) return;

    const boards = getBoards();
    const boardId = 'board-' + Date.now();
    
    // Создаем новую доску со стандартными столбцами
    boards[boardId] = {
        title: title,
        columns: [...DEFAULT_COLUMNS], // Копируем стандартные столбцы
        tasks: {
            'todo': [],
            'in-progress': [],
            'done': []
        }
    };

    localStorage.setItem('kanbanBoards', JSON.stringify(boards));
    localStorage.setItem('lastBoardId', boardId);
    
    closeBoardForm();
    loadBoards();
    
    // Устанавливаем текущую доску и отображаем её
    currentBoardId = boardId;
    renderBoard(boards[boardId]);
}

// Изменяем функцию получения досок
function getBoards() {
    if (!currentUser) {
        console.error('Пользователь не авторизован');
        return {};
    }
    
    const userId = currentUser.id;
    try {
        // Используем userId как часть ключа для хранения
        const userBoards = localStorage.getItem(`kanban_boards_${userId}`);
        return userBoards ? JSON.parse(userBoards) : {};
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
    if (!boardId) return;
    
    currentBoardId = boardId;
    localStorage.setItem('lastBoardId', boardId);
    
    const boards = getBoards();
    const board = boards[boardId];
    if (board) {
        document.getElementById('board-select').value = boardId;
        renderBoard(board);
    }
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
function renderBoard(board) {
    const kanban = document.querySelector('.kanban');
    kanban.innerHTML = '';

    board.columns.forEach(column => {
        const columnHTML = `
            <div class="column" id="${column.id}">
                <div class="column-header">
                    <h2 onclick="editColumnTitle('${column.id}')" class="column-title ${column.isDefault ? 'default-column' : ''}" 
                        title="${column.isDefault ? 'Стандартный столбец' : 'Нажмите для редактирования'}">
                        ${column.title}
                    </h2>
                    ${!column.isDefault ? `<button class="delete-column-btn" onclick="deleteColumnConfirm('${column.id}')">×</button>` : ''}
                </div>
                <div class="tasks" ondrop="drop(event)" ondragover="allowDrop(event)">
                </div>
            </div>
        `;
        kanban.insertAdjacentHTML('beforeend', columnHTML);
    });

    loadBoardTasks(board.tasks);
}

function loadBoardTasks(tasks) {
    for (const [columnId, columnTasks] of Object.entries(tasks)) {
        const column = document.querySelector(`#${columnId} .tasks`);
        columnTasks.forEach(task => {
            const filesHTML = task.files && task.files.length > 0 
                ? `<div class="task-files">
                    ${task.files.map(file => `
                        <div class="task-file">
                            <a href="#" data-file-id="${file.id}" onclick="downloadFile('${file.id}', '${file.name}'); return false;">
                                ${file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name}
                            </a>
                            <span class="file-size">${file.size}</span>
                        </div>
                    `).join('')}
                   </div>`
                : '';

            const taskHTML = `
                <div class="task" id="${task.id}" draggable="true" ondragstart="drag(event)">
                    <div class="task-header">
                        <button class="edit-btn" onclick="openEditForm('${task.id}')">✎</button>
                        <button class="delete-btn" onclick="deleteTask(event)">×</button>
                    </div>
                    <h3>${task.title}</h3>
                    <p>${task.description}</p>
                    ${filesHTML}
                </div>
            `;
            column.insertAdjacentHTML('beforeend', taskHTML);
        });
    }
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
    telegramWebApp = window.Telegram.WebApp;
    telegramWebApp.ready();
    currentUser = telegramWebApp.initDataUnsafe.user;
    
    if (!currentUser) {
        alert('Ошибка авторизации в Telegram');
        return;
    }
    
    console.log('Инициализация для пользователя:', currentUser.id);
    clearCurrentBoardData(); // Очищаем данные предыдущего пользователя
    loadUserBoards();
}

// Изменяем функцию сохранения досок
function saveBoards(boards) {
    if (!currentUser) {
        console.error('Пользователь не авторизован');
        return;
    }
    
    const userId = currentUser.id;
    try {
        // Сохраняем доски с уникальным ключом для каждого пользователя
        localStorage.setItem(`kanban_boards_${userId}`, JSON.stringify(boards));
    } catch (error) {
        console.error('Ошибка при сохранении досок:', error);
    }
}

// Изменяем функцию загрузки досок пользователя
function loadUserBoards() {
    if (!currentUser) {
        console.error('Пользователь не авторизован');
        return;
    }

    const boards = getBoards();
    console.log('Загружены доски пользователя:', currentUser.id, boards);
    updateBoardSelect();
}

// Обновляем функцию updateBoardSelect
function updateBoardSelect() {
    if (!currentUser) {
        console.error('Пользователь не авторизован');
        return;
    }

    const boards = getBoards();
    const select = document.getElementById('board-select');
    select.innerHTML = '<option value="">Выберите доску</option>';
    
    Object.values(boards).forEach(board => {
        // Дополнительная проверка владельца доски
        if (board.owner === currentUser.id) {
            const option = document.createElement('option');
            option.value = board.id;
            option.textContent = board.name;
            select.appendChild(option);
        }
    });
}

// Добавляем функцию очистки при выходе
function clearCurrentBoardData() {
    currentBoardId = null;
    currentColumn = null;
    document.querySelector('.kanban').innerHTML = '';
}

// Добавляем функцию создания доски
async function createBoard() {
    if (!currentUser) {
        alert('Необходимо авторизоваться');
        return;
    }

    const boardName = prompt('Введите название доски:');
    if (!boardName) return;

    const boardId = 'board-' + Date.now();
    const boards = getBoards();
    
    boards[boardId] = {
        id: boardId,
        name: boardName,
        owner: currentUser.id,
        columns: [
            {
                id: 'column-' + Date.now(),
                title: 'К выполнению'
            }
        ]
    };
    
    saveBoards(boards);
    updateBoardSelect();
}