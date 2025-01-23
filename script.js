let currentColumn;
let currentBoardId;
const DEFAULT_COLUMNS = [
    { id: 'todo', title: 'К выполнению', isDefault: true },
    { id: 'in-progress', title: 'В процессе', isDefault: true },
    { id: 'done', title: 'Готово', isDefault: true }
];

// Добавляем переменную для хранения файлов текущей задачи
let currentTaskFiles = [];

// Добавляем переменные для редактирования
let editingTaskId = null;
let editingTaskFiles = [];

// Добавляем переменные для работы с IndexedDB
const DB_NAME = 'KanbanDB';
const DB_VERSION = 2;
let db;

// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp;

// Добавляем информацию о пользователе
let currentUser = null;

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    // Получаем данные пользователя из Telegram
    if (tg.initDataUnsafe?.user) {
        currentUser = {
            id: tg.initDataUnsafe.user.id,
            username: tg.initDataUnsafe.user.username,
            firstName: tg.initDataUnsafe.user.first_name,
            lastName: tg.initDataUnsafe.user.last_name
        };
        
        // Отображаем имя пользователя
        document.getElementById('user-name').textContent = 
            currentUser.firstName + (currentUser.lastName ? ' ' + currentUser.lastName : '');
        
        // Инициализируем приложение
        await initDB();
        loadUserData();
    } else {
        console.error('Не удалось получить данные пользователя');
    }

    // Настраиваем тему в соответствии с Telegram
    document.body.className = tg.colorScheme;
});

// Модифицируем обработчик загрузки страницы
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initializeStorage();
    loadBoards();
    loadLastBoard();
});

// Проверяем поддержку Drag and Drop и включаем альтернативный режим если нужно
const isDragAndDropSupported = 'draggable' in document.createElement('div');

if (!isDragAndDropSupported) {
    // Альтернативная реализация перемещения карточек
    function enableTouchControls() {
        const tasks = document.querySelectorAll('.task');
        tasks.forEach(task => {
            task.addEventListener('click', function() {
                const currentColumn = this.closest('.column');
                const columns = document.querySelectorAll('.column');
                
                // Показываем диалог выбора колонки
                const columnNames = Array.from(columns).map(col => {
                    const title = col.querySelector('h2').textContent;
                    return { title, id: col.id };
                });
                
                const select = document.createElement('select');
                columnNames.forEach(col => {
                    const option = document.createElement('option');
                    option.value = col.id;
                    option.text = col.title;
                    if (col.id === currentColumn.id) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                
                const dialog = document.createElement('div');
                dialog.className = 'move-dialog';
                dialog.innerHTML = `
                    <h3>Переместить в колонку:</h3>
                    ${select.outerHTML}
                    <button onclick="moveTask('${task.id}', this.previousElementSibling.value)">Переместить</button>
                `;
                
                document.body.appendChild(dialog);
            });
        });
    }
    
    function moveTask(taskId, columnId) {
        const task = document.getElementById(taskId);
        const targetColumn = document.querySelector(`#${columnId} .tasks`);
        targetColumn.appendChild(task);
        document.querySelector('.move-dialog').remove();
        saveTasks();
    }
    
    // Добавляем стили для диалога
    const style = document.createElement('style');
    style.textContent = `
        .move-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
        }
        
        .move-dialog select {
            display: block;
            width: 100%;
            margin: 10px 0;
            padding: 8px;
        }
        
        .move-dialog button {
            width: 100%;
            padding: 8px;
            background: #0079bf;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
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

// Модифицируем функцию handleFileSelect
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

// Модифицируем функцию addTask
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

// Добавляем функцию удаления задачи
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
async function saveTasks() {
    if (!currentUser || !currentBoardId) return;

    const boards = await getBoards();
    const tasks = {};

    DEFAULT_COLUMNS.forEach(column => {
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

    if (boards[currentBoardId]) {
        boards[currentBoardId].tasks = tasks;
        await saveBoards(boards);
    }
}

// Загрузить задачи из localStorage
function loadTasks() {
    const tasks = JSON.parse(localStorage.getItem('kanbanTasks')) || {};
    
    for (const [columnId, columnTasks] of Object.entries(tasks)) {
        const column = document.querySelector(`#${columnId} .tasks`);
        columnTasks.forEach(task => {
            const taskHTML = `
                <div class="task" id="${task.id}" draggable="true" ondragstart="drag(event)">
                    <button class="delete-btn" onclick="deleteTask(event)">×</button>
                    <h3>${task.title}</h3>
                    <p>${task.description}</p>
                </div>
            `;
            column.insertAdjacentHTML('beforeend', taskHTML);
        });
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

async function getBoards() {
    if (!currentUser) return {};

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['boards'], 'readonly');
        const store = transaction.objectStore('boards');
        const index = store.index('userId');
        const request = index.getAll(IDBKeyRange.only(currentUser.id));

        request.onsuccess = () => {
            const boards = {};
            request.result.forEach(board => {
                boards[board.id] = board.data;
            });
            resolve(boards);
        };
        request.onerror = () => reject(request.error);
    });
}

async function saveBoards(boards) {
    if (!currentUser) return;

    const transaction = db.transaction(['boards'], 'readwrite');
    const store = transaction.objectStore('boards');

    // Удаляем старые доски пользователя
    const index = store.index('userId');
    const deleteRequest = index.openKeyCursor(IDBKeyRange.only(currentUser.id));
    
    deleteRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
        } else {
            // Сохраняем новые доски
            Object.entries(boards).forEach(([boardId, boardData]) => {
                store.put({
                    id: boardId,
                    userId: currentUser.id,
                    data: boardData
                });
            });
        }
    };
}

async function loadBoards() {
    const boards = await getBoards();
    const select = document.getElementById('board-select');
    select.innerHTML = '';
    
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

async function switchBoard(boardId) {
    if (!boardId) return;
    
    currentBoardId = boardId;
    localStorage.setItem('lastBoardId', boardId);
    
    const boards = await getBoards();
    const board = boards[boardId];
    if (board) {
        document.getElementById('board-select').value = boardId;
        renderBoard(board);
    }
}

// Модифицируем функцию loadBoardTasks
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
                        <button class="edit-btn" onclick="showEditForm('${task.id}')">✎</button>
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

// Добавляем функцию инициализации хранилища
async function initializeStorage() {
    const boards = await getBoards();
    if (Object.keys(boards).length === 0) {
        const defaultBoardId = 'board-' + Date.now();
        const initialBoard = {
            [defaultBoardId]: {
                title: 'Моя первая доска',
                columns: [...DEFAULT_COLUMNS],
                tasks: {
                    'todo': [],
                    'in-progress': [],
                    'done': []
                }
            }
        };
        await saveBoards(initialBoard);
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

// Функция открытия формы редактирования
function showEditForm(taskId) {
    const task = document.getElementById(taskId);
    if (!task) return;

    editingTaskId = taskId;
    const title = task.querySelector('h3').innerText;
    const description = task.querySelector('p').innerText;
    
    // Загружаем текущие файлы
    editingTaskFiles = [];
    const fileElements = task.querySelectorAll('.task-file');
    fileElements.forEach(fileEl => {
        const link = fileEl.querySelector('a');
        editingTaskFiles.push({
            id: link.dataset.fileId,
            name: link.getAttribute('download'),
            size: fileEl.querySelector('.file-size').textContent
        });
    });

    // Заполняем форму
    document.getElementById('edit-task-title').value = title;
    document.getElementById('edit-task-description').value = description;
    
    // Отображаем текущие файлы
    updateEditFileList();
    
    document.getElementById('edit-task-form').style.display = 'block';
}

// Функция закрытия формы редактирования
function closeEditForm() {
    document.getElementById('edit-task-form').style.display = 'none';
    document.getElementById('edit-task-title').value = '';
    document.getElementById('edit-task-description').value = '';
    document.getElementById('edit-file-list').innerHTML = '';
    editingTaskId = null;
    editingTaskFiles = [];
}

// Обработчик выбора файлов при редактировании
async function handleEditFileSelect(event) {
    const files = event.target.files;
    
    for (const file of files) {
        try {
            const fileId = await saveFileToIndexedDB(file);
            editingTaskFiles.push({
                id: fileId,
                name: file.name,
                size: formatFileSize(file.size)
            });
            updateEditFileList();
        } catch (error) {
            console.error('Ошибка при сохранении файла:', error);
            alert(`Ошибка при сохранении файла ${file.name}`);
        }
    }
}

// Обновление списка файлов в форме редактирования
function updateEditFileList() {
    const fileList = document.getElementById('edit-file-list');
    fileList.innerHTML = '';
    
    editingTaskFiles.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            ${file.name}
            <span class="file-size">${file.size}</span>
            <button onclick="removeEditFile('${file.id}')">×</button>
        `;
        fileList.appendChild(fileItem);
    });
}

// Удаление файла при редактировании
function removeEditFile(fileId) {
    editingTaskFiles = editingTaskFiles.filter(file => file.id !== fileId);
    updateEditFileList();
}

// Сохранение изменений задачи
async function updateTask() {
    if (!editingTaskId) return;

    const title = document.getElementById('edit-task-title').value.trim();
    const description = document.getElementById('edit-task-description').value.trim();
    
    if (!title) {
        alert('Название задачи не может быть пустым');
        return;
    }

    const task = document.getElementById(editingTaskId);
    if (!task) return;

    // Обновляем основную информацию
    task.querySelector('h3').innerText = title;
    task.querySelector('p').innerText = description;

    // Обновляем файлы
    let filesHTML = '';
    if (editingTaskFiles.length > 0) {
        filesHTML = `
            <div class="task-files">
                ${editingTaskFiles.map(file => `
                    <div class="task-file">
                        <a href="#" data-file-id="${file.id}" onclick="downloadFile('${file.id}', '${file.name}'); return false;">
                            ${file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name}
                        </a>
                        <span class="file-size">${file.size}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Обновляем секцию с файлами
    let filesSection = task.querySelector('.task-files');
    if (filesSection) {
        filesSection.remove();
    }
    if (filesHTML) {
        task.insertAdjacentHTML('beforeend', filesHTML);
    }

    closeEditForm();
    saveTasks();
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

    if (!isDragAndDropSupported) {
        enableTouchControls();
    }
}

function checkBrowserSupport() {
    const requirements = {
        indexedDB: !!window.indexedDB,
        localStorage: !!window.localStorage,
        dragAndDrop: 'draggable' in document.createElement('div'),
        webCrypto: !!window.crypto?.subtle
    };

    const unsupported = Object.entries(requirements)
        .filter(([, supported]) => !supported)
        .map(([api]) => api);

    if (unsupported.length > 0) {
        console.error('Неподдерживаемые API:', unsupported);
        alert('Ваш браузер не поддерживает необходимые технологии: ' + unsupported.join(', '));
        return false;
    }

    return true;
}

// Вызываем проверку при загрузке
document.addEventListener('DOMContentLoaded', () => {
    if (!checkBrowserSupport()) return;
    // ... rest of initialization code ...
});

// Обработка ошибок
window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
    // Можно отправлять ошибки в систему аналитики
});

// Проверка поддержки необходимых API
function checkSupport() {
    if (!window.indexedDB) {
        alert('Ваш браузер не поддерживает необходимые технологии');
        return false;
    }
    return true;
}

// Версионирование кэша
const CACHE_VERSION = '1.0.0';