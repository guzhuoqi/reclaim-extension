document.addEventListener('DOMContentLoaded', () => {
  // Sample data - in a real extension, this would come from APIs or storage
  const upcomingTasks = [
    { time: '10:00 AM', title: 'Team Meeting', duration: '30 min' },
    { time: '2:00 PM', title: 'Project Review', duration: '45 min' },
    { time: '4:30 PM', title: 'Client Call', duration: '60 min' }
  ];

  // Initialize the UI
  initializeUI();

  // Add event listeners
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('open-reclaim-btn').addEventListener('click', openReclaimApp);

  /**
   * Initialize the UI with data
   */
  function initializeUI() {
    // Get the tasks from storage or use sample data for demo
    chrome.storage.sync.get(['tasks'], function(result) {
      const tasks = result.tasks || upcomingTasks;
      renderTasks(tasks);
    });

    // Check extension status
    chrome.storage.sync.get(['isActive'], function(result) {
      const isActive = result.isActive !== undefined ? result.isActive : true;
      updateStatusIndicator(isActive);
    });
  }

  /**
   * Render the task list in the UI
   */
  function renderTasks(tasks) {
    const tasksList = document.getElementById('tasks-list');
    
    // Clear existing tasks
    tasksList.innerHTML = '';
    
    // Add each task to the list
    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'task';
      
      li.innerHTML = `
        <div class="task-time">${task.time}</div>
        <div class="task-details">
          <div class="task-title">${task.title}</div>
          <div class="task-duration">${task.duration}</div>
        </div>
      `;
      
      tasksList.appendChild(li);
    });
  }

  /**
   * Update the status indicator based on extension active state
   */
  function updateStatusIndicator(isActive) {
    const indicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status p');
    
    if (isActive) {
      indicator.classList.add('active');
      statusText.textContent = 'Extension Active';
    } else {
      indicator.classList.remove('active');
      statusText.textContent = 'Extension Inactive';
    }
  }

  /**
   * Open the settings page
   */
  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  /**
   * Open the Reclaim web app
   */
  function openReclaimApp() {
    chrome.tabs.create({ url: 'https://app.reclaim.ai/' });
  }
}); 