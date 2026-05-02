document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('courses-grid');
  const modal = document.getElementById('create-modal');
  const form = document.getElementById('create-form');
  const nameInput = document.getElementById('course-name');
  const countEl = document.getElementById('course-count');
  const toast = document.getElementById('toast');

  let toastTimeout = null;
  function showToast(msg, ms = 2500) {
    clearTimeout(toastTimeout);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(courses) {
    if (countEl) {
      countEl.textContent = courses.length
        ? `${courses.length} course${courses.length !== 1 ? 's' : ''}`
        : '';
    }

    if (!courses.length) {
      grid.innerHTML = '<div class="placeholder">No courses yet — click "+ NEW COURSE" to get started.</div>';
      return;
    }

    grid.innerHTML = '';
    for (const c of courses) {
      const a = document.createElement('a');
      a.href = `/study?course=${encodeURIComponent(c.id)}`;
      a.className = 'card';
      a.style.cssText = 'text-decoration:none;color:inherit;display:block;transition:transform 0.08s,box-shadow 0.08s';
      a.addEventListener('mouseenter', () => {
        a.style.transform = 'translate(-2px,-2px)';
        a.style.boxShadow = '5px 5px 0 #000';
      });
      a.addEventListener('mouseleave', () => {
        a.style.transform = '';
        a.style.boxShadow = '';
      });

      const created = new Date(c.createdAt).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      const hasTextbook = !!c.chaptersDir;

      a.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
          <h3 style="font-size:1.05rem;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;line-height:1.2">${escapeHtml(c.name)}</h3>
          <span style="font-size:1.1rem;color:#bbb;flex-shrink:0;font-weight:900;line-height:1.2">→</span>
        </div>
        <div style="font-family:monospace;font-size:0.68rem;color:var(--muted);margin-top:0.5rem;background:var(--bg);display:inline-block;padding:2px 6px;border:1px solid #ddd;letter-spacing:0.5px">${escapeHtml(c.domain)}</div>
        <div style="display:flex;gap:1rem;align-items:center;margin-top:1rem;font-size:0.72rem;color:var(--muted)">
          <span>Created ${escapeHtml(created)}</span>
          ${hasTextbook ? '<span style="color:#2f9e44;font-weight:700">📚 Textbook</span>' : '<span style="color:#ccc">No textbook</span>'}
        </div>
      `;
      grid.appendChild(a);
    }
  }

  function load() {
    fetch('/api/courses')
      .then(r => r.json())
      .then(data => render(data.courses || []))
      .catch(() => {
        grid.innerHTML = '<div class="placeholder">Could not connect to server — is <code style="font-family:monospace;background:#f0f0f0;padding:1px 4px">npm run dev</code> running?</div>';
      });
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
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'CREATING…';
    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');
      modal.close();
      showToast(`Course "${name}" created`);
      load();
    } catch (err) {
      alert('Failed to create course: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'CREATE';
    }
  });

  load();
});
