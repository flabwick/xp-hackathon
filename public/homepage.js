document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('courses-grid');
  const modal = document.getElementById('create-modal');
  const form = document.getElementById('create-form');
  const nameInput = document.getElementById('course-name');
  const toast = document.getElementById('toast');

  let toastTimeout = null;
  function showToast(msg, ms = 2500) {
    clearTimeout(toastTimeout);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(courses) {
    if (!courses.length) {
      grid.innerHTML = '<div class="placeholder">No courses yet. Click "+ CREATE COURSE" to get started.</div>';
      return;
    }
    grid.innerHTML = '';
    for (const c of courses) {
      const a = document.createElement('a');
      a.href = `/study?course=${encodeURIComponent(c.id)}`;
      a.className = 'card';
      a.style.cssText = 'text-decoration:none;color:inherit;display:block';
      const created = new Date(c.createdAt).toLocaleDateString();
      a.innerHTML = `
        <h3>${escapeHtml(c.name)}</h3>
        <div style="font-size:0.75rem;color:#666;margin-top:0.5rem">Created ${created}</div>
      `;
      grid.appendChild(a);
    }
  }

  function load() {
    fetch('/api/courses')
      .then(r => r.json())
      .then(data => render(data.courses || []))
      .catch(() => { grid.innerHTML = '<div class="placeholder">Failed to load courses.</div>'; });
  }

  document.getElementById('create-course').addEventListener('click', () => {
    nameInput.value = '';
    modal.showModal();
    nameInput.focus();
  });

  document.getElementById('close-create').addEventListener('click', () => modal.close());
  document.getElementById('cancel-create').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');
      modal.close();
      showToast(`✓ Course "${name}" created`);
      load();
    } catch (err) {
      alert('Failed to create course: ' + err.message);
    }
  });

  load();
});
