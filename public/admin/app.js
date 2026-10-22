// The Grimoire admin dashboard is served by a static host in development, so
// the API origin is configurable. api-config.js resolves it from the
// explicit override (window.__API_BASE__), the host's meta tag, the
// development loopback fallback, or the same-origin default, in that order.
// The same-origin default ('/api') is what happens when the dashboard is
// served directly by the backend, and is the correct production behaviour.
const API_BASE = (window.AdminConfig && window.AdminConfig.apiBase) || '/api';

const State = {
    user: null,
    activePane: 'overview',
    activeSéance: 'séance',
    activeMessages: 'messages',
    categories: [],
};

const DOM = {
    views: {
        login: document.getElementById('view-login'),
        dashboard: document.getElementById('view-dashboard'),
    },
    panes: {
        overview: document.getElementById('pane-overview'),
        blog: document.getElementById('pane-blog'),
        vault: document.getElementById('pane-vault'),
        categories: document.getElementById('pane-categories'),
        stories: document.getElementById('pane-stories'),
        'séance': document.getElementById('pane-séance'),
        messages: document.getElementById('pane-messages'),
    },
    stats: {
        posts: document.getElementById('stat-posts'),
        artifacts: document.getElementById('stat-artifacts'),
        categories: document.getElementById('stat-categories'),
    },
    tables: {
        posts: document.querySelector('#table-posts tbody'),
        artifacts: document.querySelector('#table-artifacts tbody'),
        categories: document.querySelector('#table-categories tbody'),
        stories: document.querySelector('#table-stories tbody'),
    },
    modal: {
        overlay: document.getElementById('modal-overlay'),
        body: document.getElementById('modal-body'),
        close: document.getElementById('btn-close-modal'),
    },
    loginForm: document.getElementById('form-login'),
    loginError: document.getElementById('login-error'),
};

async function apiFetch(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    
    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase())) {
        const csrfRes = await fetch(`${API_BASE}/auth/csrf-token`, { credentials: 'include' });
        if (!csrfRes.ok) throw new Error('CSRF token retrieval failed');
        const { token } = await csrfRes.json();
        headers['x-csrf-token'] = token;
    }

    // The session cookie and the CSRF cookies must travel with every request.
    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers, credentials: 'include' });
    
    if (response.status === 401) {
        // A 401 on the login endpoint means the credentials were refused, not
        // that an existing session expired. Only bounce to the login view for
        // an already-authenticated session, and always surface the server's
        // own message so the user sees why the attempt failed.
        const err = await response.json().catch(() => ({}));
        if (!endpoint.endsWith('/auth/login')) showView('login');
        throw new Error(err.error || 'Session expired');
    }
    
    if (response.status === 403) {
        throw new Error('Forbidden: Invalid CSRF token or permission');
    }

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'API Request failed');
    }

    return response.status === 204 ? null : response.json();
}

function showView(viewName) {
    Object.values(DOM.views).forEach(v => v.classList.add('hidden'));
    DOM.views[viewName].classList.remove('hidden');
}

function showPane(paneName) {
    Object.values(DOM.panes).forEach(p => p.classList.add('hidden'));
    DOM.panes[paneName].classList.remove('hidden');
    State.activePane = paneName;
    
    if (paneName === 'overview') loadOverview();
    if (paneName === 'blog') loadBlog();
    if (paneName === 'vault') loadVault();
    if (paneName === 'categories') loadCategories();
    if (paneName === 'stories') loadStories();
    if (paneName === 'séance') loadSéance();
    if (paneName === 'messages') loadMessages();
}

async function loadOverview() {
    try {
        const [posts, artifacts, cats] = await Promise.all([
            apiFetch('/admin/posts'),
            apiFetch('/admin/artifacts'),
            apiFetch('/admin/categories'),
        ]);
        DOM.stats.posts.textContent = posts.length;
        DOM.stats.artifacts.textContent = artifacts.length;
        DOM.stats.categories.textContent = cats.length;
    } catch (e) {
        console.error('Overview load failed', e);
    }
}

async function loadBlog() {
    try {
        const posts = await apiFetch('/admin/posts');
        DOM.tables.posts.innerHTML = '';
        posts.forEach(post => {
            const catNames = post.categories.map(c => c.category.name).join(', ');
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(post.title)}</td>
                <td>${post.published ? 'Published' : 'Draft'}</td>
                <td>${escapeHtml(catNames)}</td>
                <td>
                    <button class="btn-action" onclick="editPost('${post.id}')">Edit</button>
                    <button class="btn-action btn-danger" onclick="deletePost('${post.id}')">Delete</button>
                    <button class="btn-action" onclick="togglePublishPost('${post.id}', ${post.published})">${post.published ? 'Unpublish' : 'Publish'}</button>
                </td>
            `;
            DOM.tables.posts.appendChild(row);
        });
    } catch (e) {
        console.error('Blog load failed', e);
    }
}

async function loadVault() {
    try {
        const artifacts = await apiFetch('/admin/artifacts');
        DOM.tables.artifacts.innerHTML = '';
        artifacts.forEach(art => {
            const catNames = art.categories.map(c => c.category.name).join(', ');
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(art.name)}</td>
                <td>${art.published ? 'Published' : 'Draft'}</td>
                <td>${escapeHtml(catNames)}</td>
                <td>
                    <button class="btn-action" onclick="editArtifact('${art.id}')">Edit</button>
                    <button class="btn-action btn-danger" onclick="deleteArtifact('${art.id}')">Delete</button>
                    <button class="btn-action" onclick="togglePublishArtifact('${art.id}', ${art.published})">${art.published ? 'Unpublish' : 'Publish'}</button>
                </td>
            `;
            DOM.tables.artifacts.appendChild(row);
        });
    } catch (e) {
        console.error('Vault load failed', e);
    }
}

async function loadCategories() {
    try {
        State.categories = await apiFetch('/admin/categories');
        DOM.tables.categories.innerHTML = '';
        State.categories.forEach(cat => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(cat.name)}</td>
                <td>${escapeHtml(cat.slug)}</td>
                <td>
                    <button class="btn-action" onclick="editCategory('${cat.id}')">Edit</button>
                    <button class="btn-action btn-danger" onclick="deleteCategory('${cat.id}')">Delete</button>
                </td>
            `;
            DOM.tables.categories.appendChild(row);
        });
    } catch (e) {
        console.error('Categories load failed', e);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


async function loadMessages() {
    try {
        // The inquiry inbox lives under the inquiries router, whose protected
        // list route is GET /api/inquiries/admin (not /api/admin/inquiries).
        const messages = await apiFetch('/inquiries/admin');
        const container = document.getElementById('pane-messages');
        
        if (messages.length === 0) {
            container.innerHTML = `<h2 class="mb-8">No Inquiries</h2><p class="text-on-primary-container">The void is currently silent.</p>`;
            return;
        }

        let html = `<h2 class="mb-8">Inquiry Inbox</h2><div class="space-y-6">`;
        messages.forEach(msg => {
            html += `
            <div class="p-4 border border-white/10 bg-surface-container-lowest">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-label-sm text-primary uppercase">${escapeHtml(msg.name)} &lt;${escapeHtml(msg.email)}&gt;</span>
                    <span class="text-xs opacity-50">${new Date(msg.createdAt).toLocaleString()}</span>
                </div>
                <p class="text-on-surface-variant italic">${escapeHtml(msg.message)}</p>
            </div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    } catch (e) {
        console.error('Messages load failed', e);
    }
}



async function loadSéance() {
    try {
        const comments = await apiFetch('/comments/admin');
        const container = document.getElementById('pane-séance');
        
        let html = `<h2 class="mb-8">The Séance Moderation</h2><div class="space-y-6">`;
        comments.forEach(c => {
            const statusClass = c.status === 'approved' ? 'border-green-500 text-green-500'
                : c.status === 'rejected' ? 'border-red-500 text-red-500'
                : 'border-yellow-500 text-yellow-500';
            html += `
            <div class="p-4 border border-white/10 bg-surface-container-lowest">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-label-sm text-primary uppercase">${escapeHtml(c.author)} <span class="opacity-50 ml-2">on ${escapeHtml(c.post ? c.post.title : 'Unknown Entry')}</span></span>
                    <span class="text-xs px-2 py-1 border ${statusClass}">${escapeHtml(c.status)}</span>
                </div>
                <p class="text-on-surface-variant italic mb-4">${escapeHtml(c.content)}</p>
                <div class="flex gap-3">
                    <button class="btn-action text-green-500" onclick="moderateComment('${c.id}', 'approved')">Approve</button>
                    <button class="btn-action text-yellow-500" onclick="moderateComment('${c.id}', 'rejected')">Reject</button>
                    <button class="btn-action btn-danger" onclick="deleteComment('${c.id}')">Erase</button>
                </div>
            </div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    } catch (e) {
        console.error('Séance load failed', e);
    }
}

window.moderateComment = async (id, status) => {
    try {
        await apiFetch(`/comments/admin/${id}`, { 
            method: 'PATCH', 
            body: JSON.stringify({ status }) 
        });
        loadSéance();
    } catch (e) { alert(e.message); }
};

window.deleteComment = async (id) => {
    if (!confirm('Erase this voice from existence?')) return;
    try {
        await apiFetch(`/comments/admin/${id}`, { method: 'DELETE' });
        loadSéance();
    } catch (e) { alert(e.message); }
};


// MODAL UTILS
//
// A modal dialog has to behave like one for a keyboard or screen-reader
// user: the focus moves into it when it opens, it stays inside it while it
// is open, Escape closes it, and the focus returns to whatever opened it.
let modalReturnFocus = null;

const FOCUSABLE_IN_MODAL = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

function modalFocusableElements() {
    return Array.from(
        DOM.modal.overlay.querySelectorAll(FOCUSABLE_IN_MODAL)
    ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function openModal(contentHtml) {
    // Remember where the focus came from, so it can be restored.
    modalReturnFocus = document.activeElement;

    DOM.modal.body.innerHTML = contentHtml;
    DOM.modal.overlay.classList.remove('hidden');

    // Move the focus into the dialog: the close button first, so the
    // keyboard user can dismiss it immediately.
    const focusable = modalFocusableElements();
    const target = focusable.find((el) => el.id === 'btn-close-modal') || focusable[0];
    if (target) {
        target.focus();
    }
}

function closeModal() {
    DOM.modal.overlay.classList.add('hidden');
    DOM.modal.body.innerHTML = '';

    // Return the focus to whatever opened the dialog.
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
        modalReturnFocus.focus();
    }
    modalReturnFocus = null;
}

// Escape closes the dialog.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (DOM.modal.overlay.classList.contains('hidden')) return;
    e.preventDefault();
    closeModal();
});

// The focus cannot leave the dialog while it is open.
DOM.modal.overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;

    const focusable = modalFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

// Clicking the backdrop closes the dialog, but a click inside it does not.
DOM.modal.overlay.addEventListener('mousedown', (e) => {
    if (e.target === DOM.modal.overlay) closeModal();
});

// HANDLERS
DOM.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    DOM.loginError.textContent = '';
    const formData = new FormData(DOM.loginForm);
    try {
        await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify(Object.fromEntries(formData)),
        });
        showView('dashboard');
        showPane('overview');
    } catch (e) {
        DOM.loginError.textContent = e.message;
    }
};

document.getElementById('btn-logout').onclick = async () => {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } catch (e) {
        // A logout that the server refuses (for example because the session
        // had already expired) must still return the operator to the login
        // screen: the local session is over either way.
        console.warn('Logout request failed, returning to the login screen:', e.message);
    }
    // The token is revoked on the server and the cookie is cleared, so the
    // local state is dropped unconditionally.
    State.user = null;
    showView('login');
};

document.querySelectorAll('.nav-links a[data-link]').forEach(link => {
    link.onclick = (e) => {
        e.preventDefault();
        showPane(link.dataset.link);
    };
});

DOM.modal.close.onclick = closeModal;

// CRUD HANDLERS
document.getElementById('btn-new-post').onclick = () => {
    openModal(`
        <h2>Create Entry</h2>
        <form id="form-post" class="modal-form">
            <div class="field"><label>Title</label><input name="title" required></div>
            <div class="field"><label>Slug</label><input name="slug" required></div>
            <div class="field"><label>Excerpt</label><input name="excerpt"></div>
            <div class="field"><label>Content</label><textarea name="content" required></textarea></div>
            <div class="field"><label>Cover Image URL</label><input name="coverImageUrl"></div>
            <div class="field"><label>Published</label><select name="published"><option value="false">Draft</option><option value="true">Published</option></select></div>
            <div class="field"><label>Categories</label><div id="post-cats" style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;"></div></div>
            <button type="submit" class="btn-primary">Save to Grimoire</button>
        </form>
    `);
    
    const catContainer = document.getElementById('post-cats');
    State.categories.forEach(cat => {
        catContainer.innerHTML += `<label><input type="checkbox" name="categoryIds" value="${cat.id}"> ${escapeHtml(cat.name)}</label>`;
    });

    document.getElementById('form-post').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            title: formData.get('title'),
            slug: formData.get('slug'),
            excerpt: formData.get('excerpt'),
            content: formData.get('content'),
            coverImageUrl: formData.get('coverImageUrl'),
            published: formData.get('published') === 'true',
            categoryIds: formData.getAll('categoryIds'),
        };
        try {
            await apiFetch('/admin/posts', { method: 'POST', body: JSON.stringify(data) });
            closeModal();
            loadBlog();
        } catch (e) {
            alert(e.message);
        }
    };
};

window.editPost = async (id) => {
    try {
        const post = await apiFetch(`/admin/posts/${id}`);
        openModal(`
            <h2>Edit Entry</h2>
            <form id="form-edit-post" class="modal-form">
                <div class="field"><label>Title</label><input name="title" value="${escapeHtml(post.title)}" required></div>
                <div class="field"><label>Slug</label><input name="slug" value="${escapeHtml(post.slug)}" required></div>
                <div class="field"><label>Excerpt</label><input name="excerpt" value="${escapeHtml(post.excerpt || '')}"></div>
                <div class="field"><label>Content</label><textarea name="content" required>${escapeHtml(post.content)}</textarea></div>
                <div class="field"><label>Cover Image URL</label><input name="coverImageUrl" value="${escapeHtml(post.coverImageUrl || '')}"></div>
                <div class="field"><label>Published</label><select name="published">
                    <option value="false" ${!post.published ? 'selected' : ''}>Draft</option>
                    <option value="true" ${post.published ? 'selected' : ''}>Published</option>
                </select></div>
                <div class="field"><label>Categories</label><div id="edit-post-cats" style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;"></div></div>
                <button type="submit" class="btn-primary">Update Entry</button>
            </form>
        `);

        const catContainer = document.getElementById('edit-post-cats');
        const postCatIds = post.categories.map(c => c.categoryId);
        State.categories.forEach(cat => {
            const checked = postCatIds.includes(cat.id) ? 'checked' : '';
            catContainer.innerHTML += `<label><input type="checkbox" name="categoryIds" value="${cat.id}" ${checked}> ${escapeHtml(cat.name)}</label>`;
        });

        document.getElementById('form-edit-post').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                title: formData.get('title'),
                slug: formData.get('slug'),
                excerpt: formData.get('excerpt'),
                content: formData.get('content'),
                coverImageUrl: formData.get('coverImageUrl'),
                published: formData.get('published') === 'true',
                categoryIds: formData.getAll('categoryIds'),
            };
            try {
                await apiFetch(`/admin/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                closeModal();
                loadBlog();
            } catch (e) {
                alert(e.message);
            }
        };
    } catch (e) {
        alert(e.message);
    }
};

window.deletePost = async (id) => {
    if (!confirm('Permanent erasure of this entry?')) return;
    try {
        await apiFetch(`/admin/posts/${id}`, { method: 'DELETE' });
        loadBlog();
    } catch (e) {
        alert(e.message);
    }
};

window.togglePublishPost = async (id, current) => {
    try {
        await apiFetch(`/admin/posts/${id}/publish`, { 
            method: 'PATCH', 
            body: JSON.stringify({ published: !current }) 
        });
        loadBlog();
    } catch (e) {
        alert(e.message);
    }
};

document.getElementById('btn-new-artifact').onclick = () => {
    openModal(`
        <h2>Add Artifact</h2>
        <form id="form-artifact" class="modal-form">
            <div class="field"><label>Name</label><input name="name" required></div>
            <div class="field"><label>Slug</label><input name="slug" required></div>
            <div class="field"><label>Description</label><textarea name="description" required></textarea></div>
            <div class="field"><label>Image URL</label><input name="imageUrl"></div>
            <div class="field"><label>File URL</label><input name="fileUrl"></div>
            <div class="field"><label>Published</label><select name="published"><option value="false">Draft</option><option value="true">Published</option></select></div>
            <div class="field"><label>Categories</label><div id="art-cats" style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;"></div></div>
            <button type="submit" class="btn-primary">Archive Artifact</button>
        </form>
    `);
    
    const catContainer = document.getElementById('art-cats');
    State.categories.forEach(cat => {
        catContainer.innerHTML += `<label><input type="checkbox" name="categoryIds" value="${cat.id}"> ${escapeHtml(cat.name)}</label>`;
    });

    document.getElementById('form-artifact').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            slug: formData.get('slug'),
            description: formData.get('description'),
            imageUrl: formData.get('imageUrl'),
            fileUrl: formData.get('fileUrl'),
            published: formData.get('published') === 'true',
            categoryIds: formData.getAll('categoryIds'),
        };
        try {
            await apiFetch('/admin/artifacts', { method: 'POST', body: JSON.stringify(data) });
            closeModal();
            loadVault();
        } catch (e) {
            alert(e.message);
        }
    };
};

window.editArtifact = async (id) => {
    try {
        const art = await apiFetch(`/admin/artifacts/${id}`);
        openModal(`
            <h2>Edit Artifact</h2>
            <form id="form-edit-art" class="modal-form">
                <div class="field"><label>Name</label><input name="name" value="${escapeHtml(art.name)}" required></div>
                <div class="field"><label>Slug</label><input name="slug" value="${escapeHtml(art.slug)}" required></div>
                <div class="field"><label>Description</label><textarea name="description" required>${escapeHtml(art.description)}</textarea></div>
                <div class="field"><label>Image URL</label><input name="imageUrl" value="${escapeHtml(art.imageUrl || '')}"></div>
                <div class="field"><label>File URL</label><input name="fileUrl" value="${escapeHtml(art.fileUrl || '')}"></div>
                <div class="field"><label>Published</label><select name="published">
                    <option value="false" ${!art.published ? 'selected' : ''}>Draft</option>
                    <option value="true" ${art.published ? 'selected' : ''}>Published</option>
                </select></div>
                <div class="field"><label>Categories</label><div id="edit-art-cats" style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;"></div></div>
                <button type="submit" class="btn-primary">Update Artifact</button>
            </form>
        `);

        const catContainer = document.getElementById('edit-art-cats');
        const artCatIds = art.categories.map(c => c.categoryId);
        State.categories.forEach(cat => {
            const checked = artCatIds.includes(cat.id) ? 'checked' : '';
            catContainer.innerHTML += `<label><input type="checkbox" name="categoryIds" value="${cat.id}" ${checked}> ${escapeHtml(cat.name)}</label>`;
        });

        document.getElementById('form-edit-art').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                name: formData.get('name'),
                slug: formData.get('slug'),
                description: formData.get('description'),
                imageUrl: formData.get('imageUrl'),
                fileUrl: formData.get('fileUrl'),
                published: formData.get('published') === 'true',
                categoryIds: formData.getAll('categoryIds'),
            };
            try {
                await apiFetch(`/admin/artifacts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                closeModal();
                loadVault();
            } catch (e) {
                alert(e.message);
            }
        };
    } catch (e) {
        alert(e.message);
    }
};

window.deleteArtifact = async (id) => {
    if (!confirm('Remove this artifact from the vault?')) return;
    try {
        await apiFetch(`/admin/artifacts/${id}`, { method: 'DELETE' });
        loadVault();
    } catch (e) {
        alert(e.message);
    }
};

window.togglePublishArtifact = async (id, current) => {
    try {
        await apiFetch(`/admin/artifacts/${id}/publish`, { 
            method: 'PATCH', 
            body: JSON.stringify({ published: !current }) 
        });
        loadVault();
    } catch (e) {
        alert(e.message);
    }
};

document.getElementById('btn-new-category').onclick = () => {
    openModal(`
        <h2>New Category</h2>
        <form id="form-category" class="modal-form">
            <div class="field"><label>Name</label><input name="name" required></div>
            <div class="field"><label>Slug</label><input name="slug" required></div>
            <button type="submit" class="btn-primary">Create Category</button>
        </form>
    `);
    document.getElementById('form-category').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        try {
            await apiFetch('/admin/categories', { 
                method: 'POST', 
                body: JSON.stringify(Object.fromEntries(formData)) 
            });
            closeModal();
            loadCategories();
        } catch (e) {
            alert(e.message);
        }
    };
};

window.editCategory = async (id) => {
    try {
        const cat = await apiFetch(`/admin/categories/${id}`);
        openModal(`
            <h2>Edit Category</h2>
            <form id="form-edit-cat" class="modal-form">
                <div class="field"><label>Name</label><input name="name" value="${escapeHtml(cat.name)}" required></div>
                <div class="field"><label>Slug</label><input name="slug" value="${escapeHtml(cat.slug)}" required></div>
                <button type="submit" class="btn-primary">Update Category</button>
            </form>
        `);
        document.getElementById('form-edit-cat').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            try {
                await apiFetch(`/admin/categories/${id}`, { 
                    method: 'PUT', 
                    body: JSON.stringify(Object.fromEntries(formData)) 
                });
                closeModal();
                loadCategories();
            } catch (e) {
                alert(e.message);
            }
        };
    } catch (e) {
        alert(e.message);
    }
};

window.deleteCategory = async (id) => {
    if (!confirm('Warning: This will fail if the category is linked to posts or artifacts. Proceed?')) return;
    try {
        await apiFetch(`/admin/categories/${id}`, { method: 'DELETE' });
        loadCategories();
    } catch (e) {
        alert(e.message);
    }
};

// --- BRANCHING STORIES -----------------------------------------------------
//
// A story is a graph: nodes hold the narrative, choices link one node to
// another. The dashboard lets an administrator author that graph and see
// whether it is structurally sound before it is published.

const StoryState = {
    current: null,   // the story currently being edited
};

/** Render the story list into the Stories pane. */
async function loadStories() {
    try {
        const stories = await apiFetch('/admin/stories');
        DOM.tables.stories.innerHTML = '';

        if (stories.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.textContent = 'No branching stories yet. Use "+ New Story" to begin one.';
            row.appendChild(cell);
            DOM.tables.stories.appendChild(row);
            return;
        }

        stories.forEach(story => {
            const structure = story.structureValid
                ? 'Valid'
                : `${story.structureErrors.length} issue(s)`;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(story.title)}</td>
                <td>${story.published ? 'Published' : 'Draft'}</td>
                <td>${escapeHtml(structure)} (${story.nodeCount} nodes, ${story.choiceCount} choices)</td>
                <td>
                    <button class="btn-action" onclick="openStoryEditor('${story.id}')">Author</button>
                    <button class="btn-action" onclick="previewStory('${story.id}')">Preview</button>
                    <button class="btn-action" onclick="togglePublishStory('${story.id}', ${story.published})">${story.published ? 'Unpublish' : 'Publish'}</button>
                    <button class="btn-action btn-danger" onclick="deleteStory('${story.id}')">Delete</button>
                </td>
            `;
            DOM.tables.stories.appendChild(row);
        });
    } catch (e) {
        console.error('Stories load failed', e);
    }
}

/** Open the story editor for a story, or a blank one for a new story. */
async function openStoryEditor(id) {
    try {
        let story;
        if (id) {
            story = await apiFetch(`/admin/stories/${id}`);
        } else {
            story = { id: null, title: '', slug: '', introduction: '', published: false, nodes: [], choices: [] };
        }
        StoryState.current = story;
        renderStoryEditor();
        // The report is written after the render, because the render replaces
        // the modal body and would otherwise discard it.
        await renderValidationReport(story);
    } catch (e) {
        alert(e.message);
    }
}

/** Build the editor's DOM. Everything is written with textContent. */
function renderStoryEditor() {
    const story = StoryState.current;
    const isNew = !story.id;

    const modal = document.createElement('div');

    // --- Story metadata ---
    const meta = document.createElement('form');
    meta.id = 'form-story-meta';
    meta.className = 'modal-form';

    const titleLabel = document.createElement('div');
    titleLabel.className = 'field';
    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    titleInput.value = story.title || '';
    titleInput.required = true;
    titleLabel.appendChild(labelled('Title', titleInput));

    const slugLabel = document.createElement('div');
    slugLabel.className = 'field';
    const slugInput = document.createElement('input');
    slugInput.name = 'slug';
    slugInput.value = story.slug || '';
    slugInput.required = true;
    slugLabel.appendChild(labelled('Slug', slugInput));

    const introLabel = document.createElement('div');
    introLabel.className = 'field';
    const introInput = document.createElement('textarea');
    introInput.name = 'introduction';
    introInput.value = story.introduction || '';
    introInput.required = true;
    introLabel.appendChild(labelled('Introduction', introInput));

    const metaButtons = document.createElement('div');
    metaButtons.className = 'field';
    const saveMeta = document.createElement('button');
    saveMeta.type = 'submit';
    saveMeta.className = 'btn-primary';
    saveMeta.textContent = isNew ? 'Create Story' : 'Save Details';
    metaButtons.appendChild(saveMeta);

    meta.appendChild(titleLabel);
    meta.appendChild(slugLabel);
    meta.appendChild(introLabel);
    meta.appendChild(metaButtons);

    meta.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            title: titleInput.value,
            slug: slugInput.value,
            introduction: introInput.value,
        };
        try {
            if (isNew) {
                const created = await apiFetch('/admin/stories', {
                    method: 'POST',
                    body: JSON.stringify(data),
                });
                StoryState.current = { ...created, nodes: [], choices: [] };
                renderStoryEditor();
                loadStories();
            } else {
                const updated = await apiFetch(`/admin/stories/${story.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data),
                });
                StoryState.current = { ...StoryState.current, ...updated };
                loadStories();
            }
        } catch (err) {
            alert(err.message);
        }
    };

    modal.appendChild(meta);

    // --- Graph structure ---
    if (story.id) {
        modal.appendChild(renderStoryStructure(story));
    }

    openModal('');
    DOM.modal.body.innerHTML = '';
    DOM.modal.body.appendChild(modal);
}

/** A labelled form control. */
function labelled(text, control) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = text;
    label.setAttribute('for', control.name || '');
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
}

/** Render the node/choice editor for a saved story. */
function renderStoryStructure(story) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '2rem';
    wrap.style.borderTop = '1px solid #333';
    wrap.style.paddingTop = '1.5rem';

    const heading = document.createElement('h3');
    heading.textContent = 'Story Structure';
    heading.style.marginBottom = '1rem';
    wrap.appendChild(heading);

    // --- Validation report ---
    const report = document.createElement('div');
    report.id = 'story-validation';
    report.className = 'field';
    wrap.appendChild(report);

    // --- Starting node ---
    const startBlock = document.createElement('div');
    startBlock.className = 'field';
    const startLabel = document.createElement('label');
    startLabel.textContent = 'Starting node';
    startLabel.setAttribute('for', 'story-start-node');
    const startSelect = document.createElement('select');
    startSelect.id = 'story-start-node';
    startSelect.name = 'startingNodeId';

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '(none yet)';
    startSelect.appendChild(noneOption);

    story.nodes.forEach(node => {
        const option = document.createElement('option');
        option.value = node.id;
        option.textContent = node.title || node.content.slice(0, 40);
        if (story.startingNodeId === node.id) option.selected = true;
        startSelect.appendChild(option);
    });

    startBlock.appendChild(startLabel);
    startBlock.appendChild(startSelect);

    const setStart = document.createElement('button');
    setStart.type = 'button';
    setStart.className = 'btn-secondary';
    setStart.textContent = 'Set as Start';
    setStart.style.marginTop = '0.5rem';
    setStart.onclick = async () => {
        if (!startSelect.value) { alert('Choose a node first.'); return; }
        try {
            await apiFetch(`/admin/stories/${story.id}/start`, {
                method: 'POST',
                body: JSON.stringify({ nodeId: startSelect.value }),
            });
            await refreshStoryEditor();
        } catch (e) { alert(e.message); }
    };
    startBlock.appendChild(setStart);
    wrap.appendChild(startBlock);

    // --- Nodes ---
    const nodesHeading = document.createElement('h4');
    nodesHeading.textContent = 'Sections';
    nodesHeading.style.margin = '1.5rem 0 0.5rem';
    wrap.appendChild(nodesHeading);

    const nodeList = document.createElement('div');
    nodeList.className = 'field';
    story.nodes.forEach(node => {
        nodeList.appendChild(renderNodeRow(story, node));
    });
    wrap.appendChild(nodeList);

    const addNode = document.createElement('button');
    addNode.type = 'button';
    addNode.className = 'btn-secondary';
    addNode.textContent = '+ Add Section';
    addNode.onclick = () => openNodeForm(story, null);
    wrap.appendChild(addNode);

    // --- Validation refresh ---
    const validateBtn = document.createElement('button');
    validateBtn.type = 'button';
    validateBtn.className = 'btn-secondary';
    validateBtn.textContent = 'Check Structure';
    validateBtn.style.marginLeft = '0.5rem';
    validateBtn.onclick = () => refreshStoryEditor();
    wrap.appendChild(validateBtn);

    return wrap;
}

/** One row per node: its text, its choices, and the controls to change them. */
function renderNodeRow(story, node) {
    const row = document.createElement('div');
    row.style.border = '1px solid #333';
    row.style.padding = '0.75rem';
    row.style.marginBottom = '0.5rem';

    const title = document.createElement('div');
    title.style.fontFamily = 'var(--font-serif)';
    title.style.color = 'var(--text-white)';
    title.textContent = node.title || '(untitled section)';
    row.appendChild(title);

    const flags = document.createElement('div');
    flags.style.fontSize = '0.8rem';
    flags.style.color = 'var(--text-muted)';
    flags.textContent = [
        node.isEnding ? 'ENDING' : 'passage',
        node.published ? 'published' : 'unpublished',
    ].join(' · ');
    row.appendChild(flags);

    // --- Choices leaving this node ---
    const choices = story.choices.filter(c => c.nodeId === node.id);
    const choiceList = document.createElement('div');
    choiceList.style.margin = '0.5rem 0';

    if (choices.length === 0) {
        const none = document.createElement('div');
        none.style.fontSize = '0.8rem';
        none.style.color = 'var(--text-muted)';
        none.textContent = node.isEnding
            ? 'No choices (this is an ending).'
            : 'No choices yet.';
        choiceList.appendChild(none);
    }

    choices.forEach(choice => {
        const dest = story.nodes.find(n => n.id === choice.destinationNodeId);
        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.gap = '0.5rem';
        line.style.marginBottom = '0.25rem';

        const label = document.createElement('span');
        label.style.flex = '1';
        label.textContent = `“${choice.label}” → ${dest ? (dest.title || '(untitled)') : '(missing node)'}`;
        line.appendChild(label);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn-action';
        edit.textContent = 'Edit';
        edit.onclick = () => openChoiceForm(story, node, choice);
        line.appendChild(edit);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-action btn-danger';
        del.textContent = 'Delete';
        del.onclick = async () => {
            if (!confirm('Remove this choice?')) return;
            try {
                await apiFetch(`/admin/stories/${story.id}/choices/${choice.id}`, { method: 'DELETE' });
                await refreshStoryEditor();
                loadStories();
            } catch (e) { alert(e.message); }
        };
        line.appendChild(del);

        choiceList.appendChild(line);
    });

    row.appendChild(choiceList);

    // --- Node controls ---
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '0.5rem';
    controls.style.flexWrap = 'wrap';

    const editNode = document.createElement('button');
    editNode.type = 'button';
    editNode.className = 'btn-action';
    editNode.textContent = 'Edit Section';
    editNode.onclick = () => openNodeForm(story, node);
    controls.appendChild(editNode);

    if (!node.isEnding) {
        const addChoice = document.createElement('button');
        addChoice.type = 'button';
        addChoice.className = 'btn-action';
        addChoice.textContent = '+ Add Choice';
        addChoice.onclick = () => openChoiceForm(story, node, null);
        controls.appendChild(addChoice);
    }

    const makeStart = document.createElement('button');
    makeStart.type = 'button';
    makeStart.className = 'btn-action';
    makeStart.textContent = 'Make Start';
    makeStart.onclick = async () => {
        try {
            await apiFetch(`/admin/stories/${story.id}/start`, {
                method: 'POST',
                body: JSON.stringify({ nodeId: node.id }),
            });
            await refreshStoryEditor();
        } catch (e) { alert(e.message); }
    };
    controls.appendChild(makeStart);

    const delNode = document.createElement('button');
    delNode.type = 'button';
    delNode.className = 'btn-action btn-danger';
    delNode.textContent = 'Delete Section';
    delNode.onclick = async () => {
        if (!confirm('Delete this section? Choices that lead to it will be removed too.')) return;
        try {
            await apiFetch(`/admin/stories/${story.id}/nodes/${node.id}?strategy=detach`, { method: 'DELETE' });
            await refreshStoryEditor();
            loadStories();
        } catch (e) { alert(e.message); }
    };
    controls.appendChild(delNode);

    row.appendChild(controls);
    return row;
}

/** Form for creating or editing a node. */
function openNodeForm(story, node) {
    const isNew = !node;
    const form = document.createElement('form');
    form.id = 'form-story-node';
    form.className = 'modal-form';

    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    titleInput.value = node ? (node.title || '') : '';

    const contentInput = document.createElement('textarea');
    contentInput.name = 'content';
    contentInput.required = true;
    contentInput.value = node ? node.content : '';
    contentInput.style.height = '220px';

    const endingSelect = document.createElement('select');
    endingSelect.name = 'isEnding';
    [[false, 'Passage (offers choices)'], [true, 'Ending (no choices)']]
        .forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = text;
            if (node && node.isEnding === value) option.selected = true;
            endingSelect.appendChild(option);
        });

    const publishedSelect = document.createElement('select');
    publishedSelect.name = 'published';
    [[true, 'Published'], [false, 'Unpublished']]
        .forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = text;
            if (node && node.published === value) option.selected = true;
            publishedSelect.appendChild(option);
        });

    form.appendChild(labelled('Heading (optional)', titleInput));
    form.appendChild(labelled('Section text', contentInput));
    form.appendChild(labelled('Type', endingSelect));
    form.appendChild(labelled('Visibility', publishedSelect));

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary';
    submit.textContent = isNew ? 'Add Section' : 'Update Section';
    form.appendChild(submit);

    form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            title: titleInput.value,
            content: contentInput.value,
            isEnding: endingSelect.value === 'true',
            published: publishedSelect.value === 'true',
        };
        try {
            if (isNew) {
                await apiFetch(`/admin/stories/${story.id}/nodes`, {
                    method: 'POST',
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch(`/admin/stories/${story.id}/nodes/${node.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data),
                });
            }
            await refreshStoryEditor();
            loadStories();
        } catch (err) {
            alert(err.message);
        }
    };

    openModal('');
    DOM.modal.body.innerHTML = '';
    DOM.modal.body.appendChild(form);
}

/** Form for adding or editing a choice. */
function openChoiceForm(story, node, choice) {
    const isNew = !choice;
    const form = document.createElement('form');
    form.id = 'form-story-choice';
    form.className = 'modal-form';

    const labelInput = document.createElement('input');
    labelInput.name = 'label';
    labelInput.required = true;
    labelInput.value = choice ? choice.label : '';

    const destSelect = document.createElement('select');
    destSelect.name = 'destinationNodeId';
    destSelect.required = true;

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(choose a destination)';
    destSelect.appendChild(placeholder);

    story.nodes
        .filter(n => n.id !== node.id)
        .forEach(n => {
            const option = document.createElement('option');
            option.value = n.id;
            option.textContent = n.title || n.content.slice(0, 40);
            if (choice && choice.destinationNodeId === n.id) option.selected = true;
            destSelect.appendChild(option);
        });

    form.appendChild(labelled('Choice label', labelInput));
    form.appendChild(labelled('Leads to', destSelect));

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary';
    submit.textContent = isNew ? 'Add Choice' : 'Update Choice';
    form.appendChild(submit);

    form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            label: labelInput.value,
            destinationNodeId: destSelect.value,
        };
        try {
            if (isNew) {
                await apiFetch(`/admin/stories/${story.id}/nodes/${node.id}/choices`, {
                    method: 'POST',
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch(`/admin/stories/${story.id}/choices/${choice.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data),
                });
            }
            await refreshStoryEditor();
            loadStories();
        } catch (err) {
            alert(err.message);
        }
    };

    openModal('');
    DOM.modal.body.innerHTML = '';
    DOM.modal.body.appendChild(form);
}

/** Reload the story and re-render the editor, including the verdict. */
async function refreshStoryEditor() {
    if (!StoryState.current || !StoryState.current.id) return;
    try {
        const story = await apiFetch(`/admin/stories/${StoryState.current.id}`);
        StoryState.current = story;
        renderStoryEditor();
        // The report is written after the render, because the render replaces
        // the modal body and would otherwise discard it.
        await renderValidationReport(story);
    } catch (e) {
        console.error('Story refresh failed', e);
    }
}

/**
 * Show the server's structural verdict for the story.
 *
 * The report is fetched BEFORE the editor is re-rendered, because rendering
 * replaces the whole modal body and would discard a report that had already
 * been written into it.
 */
async function renderValidationReport(story) {
    let report = null;
    try {
        report = await apiFetch(`/admin/stories/${story.id}/validate`);
    } catch (e) {
        report = null;
    }

    const container = document.getElementById('story-validation');
    if (!container) return;
    container.innerHTML = '';

    if (!report) {
        container.textContent = 'The structure report could not be loaded.';
        return;
    }

    const box = document.createElement('div');
    box.style.padding = '0.75rem';
    box.style.border = '1px solid';
    box.style.borderColor = report.valid ? '#2e6b2e' : '#8b2020';
    box.style.background = report.valid ? '#101a10' : '#1a0d0d';

    const status = document.createElement('div');
    status.style.fontFamily = 'var(--font-serif)';
    status.style.color = report.valid ? '#7fbf7f' : '#ff8080';
    status.textContent = report.valid
        ? 'The structure is valid and this story can be published.'
        : 'The structure has problems:';
    box.appendChild(status);

    if (!report.valid) {
        const list = document.createElement('ul');
        list.style.margin = '0.5rem 0 0 1rem';
        list.style.fontSize = '0.85rem';
        report.errors.forEach(err => {
            const item = document.createElement('li');
            item.textContent = err;
            list.appendChild(item);
        });
        box.appendChild(list);
    }

    if (report.warnings && report.warnings.length) {
        const warn = document.createElement('div');
        warn.style.marginTop = '0.5rem';
        warn.style.fontSize = '0.8rem';
        warn.style.color = 'var(--text-muted)';
        warn.textContent = `Warnings: ${report.warnings.join('; ')}`;
        box.appendChild(warn);
    }

    container.appendChild(box);
}

/** Show the story's node graph as text. */
async function previewStory(id) {
    try {
        const story = await apiFetch(`/admin/stories/${id}`);
        const report = await apiFetch(`/admin/stories/${id}/validate`);

        const wrap = document.createElement('div');
        const heading = document.createElement('h2');
        heading.textContent = story.title;
        wrap.appendChild(heading);

        const intro = document.createElement('p');
        intro.style.fontStyle = 'italic';
        intro.textContent = story.introduction || '';
        wrap.appendChild(intro);

        const status = document.createElement('p');
        status.style.color = story.published ? '#7fbf7f' : 'var(--text-muted)';
        status.textContent = story.published ? 'Published' : 'Draft';
        wrap.appendChild(status);

        const list = document.createElement('ol');
        list.style.marginTop = '1rem';
        report.nodes.forEach(node => {
            const item = document.createElement('li');
            item.style.marginBottom = '0.75rem';
            item.style.paddingLeft = '0.5rem';
            item.style.borderLeft = '2px solid #333';

            const title = document.createElement('div');
            title.style.fontFamily = 'var(--font-serif)';
            title.style.color = 'var(--text-white)';
            const isStart = story.startingNodeId === node.id;
            title.textContent = `${node.title || '(untitled section)'}${isStart ? '  (start)' : ''}`;
            item.appendChild(title);

            const meta = document.createElement('div');
            meta.style.fontSize = '0.8rem';
            meta.style.color = 'var(--text-muted)';
            meta.textContent = `${node.isEnding ? 'ENDING' : 'passage'} · ${node.published ? 'published' : 'unpublished'} · ${node.choiceCount} choice(s)`;
            item.appendChild(meta);

            const nodeChoices = report.choices.filter(c => c.nodeId === node.id);
            nodeChoices.forEach(c => {
                const dest = report.nodes.find(n => n.id === c.destinationNodeId);
                const line = document.createElement('div');
                line.style.fontSize = '0.85rem';
                line.style.marginTop = '0.25rem';
                line.textContent = `  → “${c.label}” ${dest ? `→ ${dest.title || '(untitled)'}` : '→ (missing node)'}`;
                item.appendChild(line);
            });

            list.appendChild(item);
        });
        wrap.appendChild(list);

        openModal('');
        DOM.modal.body.innerHTML = '';
        DOM.modal.body.appendChild(wrap);
    } catch (e) {
        alert(e.message);
    }
}

window.openStoryEditor = openStoryEditor;
window.previewStory = previewStory;

window.togglePublishStory = async (id, current) => {
    try {
        await apiFetch(`/admin/stories/${id}/publish`, {
            method: 'PATCH',
            body: JSON.stringify({ published: !current }),
        });
        loadStories();
    } catch (e) {
        alert(e.message);
        loadStories();
    }
};

window.deleteStory = async (id) => {
    if (!confirm('Erase this branching story and all of its sections and choices?')) return;
    try {
        await apiFetch(`/admin/stories/${id}`, { method: 'DELETE' });
        loadStories();
    } catch (e) {
        alert(e.message);
    }
};

document.getElementById('btn-new-story').onclick = () => openStoryEditor(null);

// INITIALIZATION
window.onload = () => {
    // Try to load overview to check auth
    showView('login');
    // In a real app, we'd check if a session exists. 
    // For now, start at login.
};
