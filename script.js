// Supabase Configuration
const SUPABASE_URL = 'https://ffqdvcxyxtunoanrfdee.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmcWR2Y3h5eHR1bm9hbnJmZGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1Mzg1OTAsImV4cCI6MjA3MTExNDU5MH0.q1WtNtTryPSq1hXlTGilUb01dEYZbm1ZHUDvwQ8cuhc';

// Initialize Supabase client
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global State
let activeSection = 'dashboard';
let activeTab = 'consumable';
let activeAdminTab = 'current';
let selectedCategory = null;
let selectedItem = null;
let selectedMember = null;
let currentUser = null;

// Initialization flags
let isInitialized = false;
let authListenerSetup = false;

// ✅ GLOBAL DATA CACHE SYSTEM
let globalData = {
    members: [],
    categories: [],
    items: [],
    currentIssues: [],
    history: [],
    lastLoaded: null,
    isLoading: false
};

async function loadAllData(force = false) {
    if (!force && globalData.lastLoaded && 
        (Date.now() - globalData.lastLoaded) < 30000) {
        return globalData;
    }

    if (globalData.isLoading) return globalData;
    
    globalData.isLoading = true;
    showLoading(true);

    try {
        console.log('🔄 Loading all data once...');

        const [membersData, categoriesData, itemsData, currentIssuesData, historyData] = await Promise.all([
            supabaseClient.from('members').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('categories').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('items').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('issued_items').select(`
                *,
                items(name, image),
                members(name, branch, photo)
            `).eq('status', 'issued').order('issued_date', { ascending: false }),
            supabaseClient.from('issued_items').select(`
                *,
                items(name, image),
                members(name, branch, photo)
            `).eq('status', 'returned').order('returned_date', { ascending: false })
        ]);

        globalData.members = membersData.data || [];
        globalData.categories = categoriesData.data || [];
        globalData.items = itemsData.data || [];
        globalData.currentIssues = currentIssuesData.data || [];
        globalData.history = historyData.data || [];
        globalData.lastLoaded = Date.now();

        console.log('✅ Data loaded:', {
            members: globalData.members.length,
            categories: globalData.categories.length,
            items: globalData.items.length
        });

        return globalData;

    } catch (error) {
        console.error('❌ Error loading all data:', error);
        showToast('Error loading data', 'error');
        return globalData;
    } finally {
        globalData.isLoading = false;
        showLoading(false);
    }
}

async function refreshData() {
    globalData.lastLoaded = null;
    await loadAllData(true);
    
    if (activeSection === 'members') {
        populateMembersTable();
    } else if (activeSection === 'components') {
        populateCategories();
        if (selectedCategory) {
            populateItems(selectedCategory.id);
        }
    } else if (activeSection === 'admin') {
        if (activeAdminTab === 'current') {
            populateCurrentIssuesTable();
        } else {
            populateHistoryTable();
        }
    }
    
    updateStats();
}

// ✅ UPDATED FETCH FUNCTIONS WITH CACHE
async function fetchMembers() {
    if (globalData.members.length === 0) {
        await loadAllData();
    }
    return globalData.members;
}

async function fetchCategories() {
    if (globalData.categories.length === 0) {
        await loadAllData();
    }
    return globalData.categories;
}

async function fetchItems(categoryId = null) {
    if (globalData.items.length === 0) {
        await loadAllData();
    }
    
    if (categoryId) {
        return globalData.items.filter(item => item.category_id === categoryId);
    }
    return globalData.items;
}

async function fetchCurrentIssues() {
    if (globalData.currentIssues.length === 0) {
        await loadAllData();
    }
    return globalData.currentIssues;
}

async function fetchHistory() {
    if (globalData.history.length === 0) {
        await loadAllData();
    }
    return globalData.history;
}

// ✅ Enhanced Splash Screen Functions
function hideSplashScreen() {
    const splash = document.getElementById('splash-screen');
    
    splash.classList.add('fade-out');
    
    setTimeout(() => {
        splash.style.display = 'none';
        checkAuthAndShowApp();
    }, 500);
}

async function checkAuthAndShowApp() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        if (user) {
            currentUser = user;
            showMainApp();
            await init();
        } else {
            showAuthModal();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        showAuthModal();
    }
}

function showSplashAndInit() {
    const splash = document.getElementById('splash-screen');
    splash.style.display = 'flex';
    
    setTimeout(() => {
        hideSplashScreen();
    }, 10000);
}

// ✅ FORCE REFRESH FUNCTION
async function refreshAllData() {
    try {
        console.log('🔄 Force refreshing all data...');
        showLoading(true);
        
        // Clear cache and reload
        globalData.lastLoaded = null;
        await loadAllData(true);
        
        // Re-populate current view
        if (activeSection === 'components') {
            await populateCategories();
            if (selectedCategory) {
                await populateItems(selectedCategory.id);
            }
        }
        
        // Update stats
        await updateStats();
        
        console.log('✅ All data refreshed successfully');
        
    } catch (error) {
        console.error('❌ Error refreshing data:', error);
    } finally {
        showLoading(false);
    }
}

// Search Functions
async function searchItemsByProperty(searchTerm) {
    try {
        const { data, error } = await supabaseClient
            .from('items')
            .select(`
                *,
                categories(name, properties)
            `)
            .or(`
                name.ilike.%${searchTerm}%,
                property.ilike.%${searchTerm}%,
                property_values::text.ilike.%${searchTerm}%
            `);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error searching items by property:', error);
        return [];
    }
}

function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return text;
    
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
}

// Property functions
function addCustomPropertyValue() {
    const container = document.getElementById('item-property-values-list');
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 bg-gray-50 p-2 rounded border property-value-row';
    div.innerHTML = `
        <input type="text" class="w-24 p-2 border rounded text-sm custom-property-name" placeholder="Property name">
        <span class="text-sm">:</span>
        <input type="text" class="item-property-value flex-1 p-2 border rounded" data-property-name="" placeholder="Enter value">
        <button type="button" onclick="removePropertyValueRow(this)" class="text-red-500 hover:bg-red-100 p-1 rounded" title="Remove">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;
    container.appendChild(div);
    
    const nameInput = div.querySelector('.custom-property-name');
    const valueInput = div.querySelector('.item-property-value');
    nameInput.addEventListener('input', () => {
        valueInput.setAttribute('data-property-name', nameInput.value.trim());
    });
    
    lucide.createIcons();
}

function removePropertyValueRow(button) {
    button.closest('.property-value-row').remove();
}

function addPropertyInput(containerId = 'properties-list') {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
        <input type="text" class="property-input flex-1 p-2 border rounded" placeholder="Property name">
        <button type="button" onclick="removePropertyInput(this)" class="property-remove-btn">×</button>
    `;
    container.appendChild(div);
}

function removePropertyInput(button) {
    button.parentElement.remove();
}

// Show Low Stock Page
async function showLowStockPage() {
    showLoading(true);

    try {
        const items = await fetchItems();
        const lowStockItems = items.filter(item => item.available <= 5);

        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        document.getElementById('low-stock-section').classList.remove('hidden');

        const content = document.getElementById('low-stock-content');

        if (lowStockItems.length === 0) {
            content.innerHTML = `
                <div class="text-center py-12">
                    <div class="text-6xl mb-4">🎉</div>
                    <h3 class="text-xl font-semibold text-green-600 mb-2">Great! No Low Stock Items</h3>
                    <p class="text-gray-500">All items have sufficient quantity in stock.</p>
                </div>
            `;
            return;
        }

        content.innerHTML = `
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${lowStockItems.map(item => `
                    <div class="border rounded-lg p-4 ${item.available === 0 ? 'border-red-500 bg-red-50' : 'border-orange-300 bg-orange-50'}">
                        <div class="flex items-center gap-3 mb-3">
                            ${item.image ?
                `<img src="${item.image}" class="w-12 h-12 object-cover rounded" alt="Item">` :
                `<div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                    <i data-lucide="package" class="w-6 h-6 text-gray-400"></i>
                                </div>`
            }
                            <div>
                                <h3 class="font-semibold text-gray-800">${item.name}</h3>
                                ${item.property ? `<p class="text-xs text-blue-600">Property: ${item.property}</p>` : ''}
                            </div>
                        </div>
                        
                        <div class="text-center p-3 rounded ${item.available === 0 ? 'bg-red-100' : 'bg-orange-100'}">
                            <p class="text-lg font-bold ${item.available === 0 ? 'text-red-700' : 'text-orange-700'}">
                                ${item.available === 0 ? 'OUT OF STOCK' : `Only ${item.available} left`}
                            </p>
                            <p class="text-sm text-gray-600">Total: ${item.total}</p>
                        </div>
                        
                        <div class="mt-3 text-center">
                            <button onclick="showItemDetailFromLowStock(${JSON.stringify(item).replace(/"/g, '&quot;')})" 
                                    class="text-blue-500 hover:underline text-sm">
                                View Details
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        lucide.createIcons();

    } catch (error) {
        console.error('Error loading low stock items:', error);
        showToast('Error loading low stock items', 'error');
    } finally {
        showLoading(false);
    }
}

function showItemDetailFromLowStock(item) {
    selectedItem = item;

    fetchCategories().then(categories => {
        selectedCategory = categories.find(cat => cat.id === item.category_id);
        setActiveSection('components');
        setTimeout(() => {
            showItemDetail(item);
        }, 100);
    });
}

// Member Details Page
async function showMemberDetails(memberId) {
    showLoading(true);

    try {
        const { data: memberData, error: memberErr } = await supabaseClient
            .from('members')
            .select('*')
            .eq('id', memberId)
            .single();

        if (memberErr) throw memberErr;

        const { data: issuedItems, error: issuedErr } = await supabaseClient
            .from('issued_items')
            .select(`
                *,
                items(name, image, property)
            `)
            .eq('member_id', memberId)
            .eq('status', 'issued');

        if (issuedErr) throw issuedErr;

        selectedMember = memberData;

        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        document.getElementById('member-detail-section').classList.remove('hidden');

        const content = document.getElementById('member-detail-content');
        const photoHTML = memberData.photo ?
            `<img src="${memberData.photo}" class="profile-image-large" alt="Member Photo">` :
            `<div class="profile-image-large bg-gray-200 flex items-center justify-center">
                <i data-lucide="user" class="w-8 h-8 text-gray-400"></i>
            </div>`;

        content.innerHTML = `
            <div class="member-detail-card">
                <div class="flex items-center gap-6 mb-6">
                    ${photoHTML}
                    <div>
                        <h1 class="text-3xl font-bold mb-2">${memberData.name}</h1>
                        <div class="grid grid-cols-2 gap-4 text-sm opacity-90">
                            <div>
                                <p><strong>Batch:</strong> ${memberData.batch}</p>
                                <p><strong>Branch:</strong> ${memberData.branch}</p>
                            </div>
                            <div>
                                <p><strong>Year:</strong> ${memberData.year}</p>
                                <p><strong>Contact:</strong> ${memberData.contact}</p>
                            </div>
                        </div>
                        ${memberData.address ? `<p class="mt-2"><strong>Address:</strong> ${memberData.address}</p>` : ''}
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-bold mb-4 text-gray-800">Currently Issued Items (${issuedItems.length})</h2>
                
                ${issuedItems.length === 0 ?
                '<p class="text-gray-500 text-center py-8">No items currently issued to this member</p>' :
                issuedItems.map(item => `
                        <div class="member-issued-item">
                            <div class="flex items-center gap-4">
                                ${item.items?.image ?
                        `<img src="${item.items.image}" class="w-12 h-12 object-cover rounded" alt="Item">` :
                        `<div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                        <i data-lucide="package" class="w-6 h-6 text-gray-400"></i>
                                    </div>`
                    }
                                <div>
                                    <h3 class="font-semibold">${item.items?.name || 'Unknown Item'}</h3>
                                    <p class="text-sm text-gray-600">Quantity: ${item.quantity}</p>
                                    ${item.items?.property ? `<p class="text-sm text-blue-600">Property: ${item.items.property}</p>` : ''}
                                    <p class="text-xs text-gray-500">Issued: ${new Date(item.issued_date).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <button onclick="smartReturnFromMember(${item.id}, ${item.quantity})" 
                                    class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-sm">
                                Return
                            </button>
                        </div>
                    `).join('')
            }
            </div>
        `;

        lucide.createIcons();

    } catch (error) {
        console.error('Error loading member details:', error);
        showToast('Error loading member details', 'error');
    } finally {
        showLoading(false);
    }
}

async function smartReturnFromMember(issuedItemId, quantity) {
    const confirmed = await showConfirmDialog('Are you sure you want to return this item?', true);
    if (!confirmed) return;

    showLoading(true);

    try {
        const { error: returnError } = await supabaseClient
            .from('issued_items')
            .update({
                status: 'returned',
                returned_date: new Date().toISOString()
            })
            .eq('id', issuedItemId);

        if (returnError) throw returnError;

        const { data: issuedItemData } = await supabaseClient
            .from('issued_items')
            .select('item_id')
            .eq('id', issuedItemId)
            .single();

        if (issuedItemData) {
            const { data: itemData } = await supabaseClient
                .from('items')
                .select('available')
                .eq('id', issuedItemData.item_id)
                .single();

            if (itemData) {
                await supabaseClient
                    .from('items')
                    .update({
                        available: itemData.available + quantity
                    })
                    .eq('id', issuedItemData.item_id);
            }
        }

        if (selectedMember) {
            showMemberDetails(selectedMember.id);
        }

        updateStats();
        showToast('Item returned successfully');

    } catch (error) {
        console.error('Error returning item:', error);
        showToast('Error returning item', 'error');
    } finally {
        showLoading(false);
    }
}

// Smart Return System
async function smartReturn(memberId, memberName) {
    try {
        const { data: issuedItems, error } = await supabaseClient
            .from('issued_items')
            .select(`
                *,
                items(name, image)
            `)
            .eq('member_id', memberId)
            .eq('status', 'issued');

        if (error) throw error;

        if (issuedItems.length === 0) {
            showToast('No items to return for this member', 'error');
            return;
        }

        if (issuedItems.length === 1) {
            await returnItem(issuedItems[0].id, issuedItems[0].quantity);
            return;
        }

        openDialog('smartReturn');
        const title = document.getElementById('dialog-title');
        const content = document.getElementById('dialog-content');

        title.textContent = `Return Item - ${memberName}`;
        content.innerHTML = `
            <div class="space-y-4">
                <p class="text-gray-600 mb-4">Select which item to return:</p>
                <form id="return-selection-form">
                    ${issuedItems.map(item => `
                        <div class="return-item-option">
                            <input type="radio" name="return-item" value="${item.id}" data-quantity="${item.quantity}" id="item-${item.id}">
                            <label for="item-${item.id}" class="flex items-center gap-3 flex-1 cursor-pointer">
                                ${item.items?.image ?
                `<img src="${item.items.image}" class="w-10 h-10 object-cover rounded" alt="Item">` :
                `<div class="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                                        <i data-lucide="package" class="w-5 h-5 text-gray-400"></i>
                                    </div>`
            }
                                <div>
                                    <p class="font-medium">${item.items?.name || 'Unknown Item'}</p>
                                    <p class="text-sm text-gray-500">Quantity: ${item.quantity}</p>
                                    <p class="text-xs text-gray-400">Issued: ${new Date(item.issued_date).toLocaleDateString()}</p>
                                </div>
                            </label>
                        </div>
                    `).join('')}
                </form>
                <div class="flex gap-3 mt-6">
                    <button onclick="closeDialog()" class="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400">
                        Cancel
                    </button>
                    <button onclick="processSmartReturn()" class="flex-1 bg-red-500 text-white py-2 rounded hover:bg-red-600">
                        Return Selected
                    </button>
                </div>
            </div>
        `;

        lucide.createIcons();

    } catch (error) {
        console.error('Error in smart return:', error);
        showToast('Error loading items for return', 'error');
    }
}

async function processSmartReturn() {
    const form = document.getElementById('return-selection-form');
    const selected = form.querySelector('input[name="return-item"]:checked');

    if (!selected) {
        showToast('Please select an item to return', 'error');
        return;
    }

    const issuedItemId = parseInt(selected.value);
    const quantity = parseInt(selected.dataset.quantity);

    closeDialog();
    await returnItem(issuedItemId, quantity);
}

// Menu Toggle Functions
function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    const allMenus = document.querySelectorAll('.dropdown-menu');

    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('show');
        }
    });

    if (menu) {
        menu.classList.toggle('show');
    }
}

document.addEventListener('click', function (event) {
    if (!event.target.closest('.dropdown-menu') && !event.target.closest('button[onclick*="toggleMenu"]')) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
    }
});

// Edit Functions
async function editCategory(categoryId) {
    try {
        const { data, error } = await supabaseClient
            .from('categories')
            .select('*')
            .eq('id', categoryId)
            .single();

        if (error) throw error;

        openDialog('editCategory');
        document.getElementById('dialog-title').textContent = 'Edit Category';
        const content = document.getElementById('dialog-content');

        const properties = data.properties || [];

        content.innerHTML = `
            <div class="space-y-4">
                <div class="text-center">
                    <label for="edit-category-image-input" class="image-upload-area w-20 h-20 mx-auto rounded-lg overflow-hidden border-2 flex items-center justify-center bg-gray-50 cursor-pointer">
                        <img id="edit-category-image-preview" src="${data.image && (data.image.startsWith('data:') || data.image.startsWith('http')) ? data.image : 'data:,'}" class="w-full h-full object-cover ${data.image && (data.image.startsWith('data:') || data.image.startsWith('http')) ? '' : 'hidden'}">
                        <div id="edit-category-image-placeholder" class="text-center ${data.image && (data.image.startsWith('data:') || data.image.startsWith('http')) ? 'hidden' : ''}">
                            <div class="text-2xl mb-1">${data.image && !data.image.startsWith('data:') && !data.image.startsWith('http') ? data.image : '📦'}</div>
                            <p class="text-xs text-gray-500">Change Icon</p>
                        </div>
                    </label>
                    <input type="file" id="edit-category-image-input" accept="image/*" class="hidden" onchange="handleCategoryImage(this, 'edit')">
                </div>
                <input type="text" value="${data.name}" placeholder="Category Name" id="edit-category-name" class="w-full p-2 border rounded" required />
                <textarea placeholder="Description (optional)" id="edit-category-description" class="w-full p-2 border rounded" rows="3">${data.description || ''}</textarea>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Properties:</label>
                    <div id="edit-properties-list" class="space-y-2">
                        ${properties.map((prop, index) => `
                            <div class="flex items-center gap-2">
                                <input type="text" value="${prop}" class="property-input flex-1 p-2 border rounded" placeholder="Property name">
                                <button type="button" onclick="removePropertyInput(this)" class="property-remove-btn">×</button>
                            </div>
                        `).join('')}
                        <div class="flex items-center gap-2">
                            <input type="text" class="property-input flex-1 p-2 border rounded" placeholder="Add new property">
                            <button type="button" onclick="removePropertyInput(this)" class="property-remove-btn">×</button>
                        </div>
                    </div>
                    <button type="button" onclick="addPropertyInput('edit-properties-list')" class="mt-2 text-blue-500 hover:underline text-sm">+ Add Property</button>
                </div>
                
                <p class="text-sm text-gray-500">Category Type: <strong>${data.type === 'consumable' ? 'Consumable' : 'Non-Consumable'}</strong></p>
                <button onclick="updateCategory(${categoryId})" class="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                    Update Category
                </button>
            </div>
        `;

        lucide.createIcons();

    } catch (error) {
        console.error('Error loading category for edit:', error);
        showToast('Error loading category for edit', 'error');
    }
}

async function updateCategory(categoryId) {
    const name = document.getElementById('edit-category-name').value.trim();
    const description = document.getElementById('edit-category-description').value.trim();
    const imageEl = document.getElementById('edit-category-image-preview');
    const image = (imageEl && imageEl.src && imageEl.src !== 'data:,') ? imageEl.src : '📦';

    const propertyInputs = document.querySelectorAll('#edit-properties-list .property-input');
    const properties = Array.from(propertyInputs)
        .map(input => input.value.trim())
        .filter(value => value.length > 0);

    if (!name) {
        showToast('Please enter category name', 'error');
        return;
    }

    showLoading(true);

    try {
        const { error } = await supabaseClient
            .from('categories')
            .update({
                name,
                description,
                image,
                properties
            })
            .eq('id', categoryId);

        if (error) throw error;

        closeDialog();
        await refreshAllData();
        showToast('Category updated successfully');

    } catch (error) {
        console.error('Error updating category:', error);
        showToast('Error updating category', 'error');
    } finally {
        showLoading(false);
    }
}

// Admin Tab Functions
function setActiveAdminTab(tab) {
    activeAdminTab = tab;

    document.querySelectorAll('.admin-tab').forEach(btn => {
        if (btn.dataset.adminTab === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    if (tab === 'current') {
        document.getElementById('current-issues-content').classList.remove('hidden');
        populateCurrentIssuesTable();
    } else if (tab === 'history') {
        document.getElementById('history-content').classList.remove('hidden');
        populateHistoryTable();
    }
}

// Image Upload Functions
async function uploadImageToStorage(file, bucketName = 'category-images') {
    try {
        const timestamp = Date.now();
        const fileExt = file.name.split('.').pop().toLowerCase();
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${timestamp}_${cleanFileName}`;

        console.log(`🚀 Uploading to bucket: ${bucketName}, file: ${fileName}`);
        showToast('Uploading image to storage...');

        const { data, error } = await supabaseClient.storage
            .from(bucketName)
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error('❌ Storage upload error:', error);
            showToast('Storage upload failed: ' + error.message, 'error');

            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = function (e) {
                    console.log('📋 Fallback to base64 due to storage error');
                    showToast('Using fallback method for image storage', 'error');
                    resolve(e.target.result);
                };
                reader.readAsDataURL(file);
            });
        }

        const { data: { publicUrl } } = supabaseClient.storage
            .from(bucketName)
            .getPublicUrl(fileName);

        console.log('✅ Image uploaded successfully:', publicUrl);
        showToast('Image uploaded successfully');
        return publicUrl;

    } catch (error) {
        console.error('💥 Error uploading to storage:', error);
        showToast('Upload error: ' + error.message, 'error');

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                resolve(e.target.result);
            };
            reader.readAsDataURL(file);
        });
    }
}

function handleImageUpload(file, callback, bucketName = 'category-images') {
    if (file && file.type.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image size should be less than 5MB', 'error');
            return;
        }

        console.log(`📸 Processing image: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        uploadImageToStorage(file, bucketName).then(callback);
    } else {
        showToast('Please select a valid image file', 'error');
    }
}

function handleCategoryImage(input, mode = 'add') {
    const file = input.files[0];
    if (file) {
        console.log('📂 Category image selected:', file.name);

        handleImageUpload(file, (imageSrc) => {
            const previewId = mode === 'edit' ? 'edit-category-image-preview' : 'category-image-preview';
            const placeholderId = mode === 'edit' ? 'edit-category-image-placeholder' : 'category-image-placeholder';

            const preview = document.getElementById(previewId);
            const placeholder = document.getElementById(placeholderId);
            if (preview && placeholder) {
                preview.src = imageSrc;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
                console.log('✅ Category image preview updated');
            }
        }, 'category-images');
    }
}

function handleMemberPhoto(input, mode = 'add') {
    const file = input.files[0];
    if (file) {
        console.log('👤 Member photo selected:', file.name);

        handleImageUpload(file, (imageSrc) => {
            const previewId = mode === 'edit' ? 'edit-member-photo-preview' : 'member-photo-preview';
            const placeholderId = mode === 'edit' ? 'edit-member-photo-placeholder' : 'member-photo-placeholder';

            const preview = document.getElementById(previewId);
            const placeholder = document.getElementById(placeholderId);
            if (preview && placeholder) {
                preview.src = imageSrc;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
                console.log('✅ Member photo preview updated');
            }
        }, 'member-photos');
    }
}

function handleItemImage(input, mode = 'add') {
    const file = input.files[0];
    if (file) {
        console.log('🔧 Item image selected:', file.name);

        handleImageUpload(file, (imageSrc) => {
            const previewId = mode === 'edit' ? 'edit-item-image-preview' : 'item-image-preview';
            const placeholderId = mode === 'edit' ? 'edit-item-image-placeholder' : 'item-image-placeholder';

            const preview = document.getElementById(previewId);
            const placeholder = document.getElementById(placeholderId);
            if (preview && placeholder) {
                preview.src = imageSrc;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
                console.log('✅ Item image preview updated');
            }
        }, 'component-images');
    }
}

function createImagePreview(imageSrc, size = 'small', circular = false) {
    const sizeClasses = {
        small: 'w-12 h-12',
        medium: 'w-20 h-20',
        large: 'w-32 h-32'
    };

    const shapeClass = circular ? 'profile-image' : 'rounded border';

    if (imageSrc && (imageSrc.startsWith('data:image') || imageSrc.startsWith('http'))) {
        return `<img src="${imageSrc}" class="${sizeClasses[size]} object-cover ${shapeClass}" alt="Preview" onerror="this.style.display='none'">`;
    }
    return `<div class="${sizeClasses[size]} bg-gray-200 ${shapeClass} flex items-center justify-center text-gray-400">
        <i data-lucide="image" class="w-6 h-6"></i>
    </div>`;
}

// Toast and Dialog Functions
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    if (!toast || !toastMessage) return;

    toastMessage.textContent = message;
    toast.classList.remove('hidden', 'show', 'success', 'error');

    if (type === 'success') {
        toast.classList.add('success');
    } else {
        toast.classList.add('error');
    }

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 300);
    }, 3000);
}

function showConfirmDialog(message, isReturn = false) {
    return new Promise((resolve) => {
        const backdrop = document.getElementById('confirm-backdrop');
        const modal = document.getElementById('confirm-modal');
        const messageEl = document.getElementById('confirm-message');
        const cancelBtn = document.getElementById('confirm-cancel');
        const deleteBtn = document.getElementById('confirm-delete');

        messageEl.textContent = message;

        if (isReturn) {
            deleteBtn.textContent = 'Return';
            deleteBtn.className = 'confirm-btn return';
        } else {
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'confirm-btn delete';
        }

        backdrop.classList.remove('hidden');
        modal.classList.remove('hidden');

        function cleanup() {
            backdrop.classList.add('hidden');
            modal.classList.add('hidden');
            cancelBtn.removeEventListener('click', handleCancel);
            deleteBtn.removeEventListener('click', handleDelete);
        }

        function handleCancel() {
            cleanup();
            resolve(false);
        }

        function handleDelete() {
            cleanup();
            resolve(true);
        }

        cancelBtn.addEventListener('click', handleCancel);
        deleteBtn.addEventListener('click', handleDelete);
    });
}

// Authentication Functions
async function signIn() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!email || !password) {
        showToast('Please enter email and password', 'error');
        return;
    }

    showLoading(true);

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                showToast('Invalid email or password! Please check and try again.', 'error');
            } else if (error.message.includes('Email not confirmed')) {
                showToast('Email not verified! Please check your verification email.', 'error');
            } else {
                showToast('Login error: ' + error.message, 'error');
            }
            return;
        }

        currentUser = data.user;
        showMainApp();
        showToast('Successfully logged in');

    } catch (error) {
        console.error('Sign in error:', error);
        showToast('Technical error during login', 'error');
    } finally {
        showLoading(false);
    }
}

async function signUp() {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value.trim();
    const confirmPassword = document.getElementById('signup-confirm').value.trim();

    if (!email || !password || !confirmPassword) {
        showToast('Please fill all fields', 'error');
        return;
    }

    if (password.length < 6) {
        showToast('Password should be at least 6 characters', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }

    showLoading(true);

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });

        if (error) throw error;

        showToast('Account created! Please sign in now.');
        showSignIn();

    } catch (error) {
        console.error('Sign up error:', error);
        showToast('Sign up error: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        showToast('Error signing out', 'error');
    } else {
        currentUser = null;
        isInitialized = false;
        showAuthModal();
        showToast('Successfully logged out');
    }
}

async function resendVerificationEmail() {
    const email = document.getElementById('login-email').value.trim();

    if (!email) {
        showToast('Please enter email', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.resend({
            type: 'signup',
            email: email
        });

        if (error) throw error;

        showToast('Verification email resent! Please check your email.');
    } catch (error) {
        showToast('Error sending email: ' + error.message, 'error');
    }
}

function showSignIn() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('signup-form').classList.add('hidden');
}

function showSignUp() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('signup-form').classList.remove('hidden');
}

function showAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

function showLoading(show) {
    if (show) {
        document.getElementById('loading-overlay').classList.remove('hidden');
    } else {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

// ✅ CRUD FUNCTIONS WITH PROPER REFRESH
async function addMember() {
    const name = document.getElementById('member-name').value.trim();
    const batch = document.getElementById('member-batch').value.trim();
    const branch = document.getElementById('member-branch').value.trim();
    const year = document.getElementById('member-year').value.trim();
    const contact = document.getElementById('member-contact').value.trim();
    const address = document.getElementById('member-address').value.trim();
    const photoEl = document.getElementById('member-photo-preview');
    const photo = photoEl && photoEl.src !== 'data:,' ? photoEl.src : null;

    if (!name || !batch || !branch || !year || !contact) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    showLoading(true);

    try {
        const { data, error } = await supabaseClient
            .from('members')
            .insert([{
                name,
                batch,
                branch,
                year,
                contact,
                address,
                photo
            }])
            .select();

        if (error) throw error;

        closeDialog();
        await refreshAllData();
        showToast('New member added successfully');

    } catch (error) {
        console.error('Error adding member:', error);
        showToast('Error adding member', 'error');
    } finally {
        showLoading(false);
    }
}

async function addCategory() {
    const name = document.getElementById('category-name').value.trim();
    const description = document.getElementById('category-description').value.trim();
    const imageEl = document.getElementById('category-image-preview');
    const image = imageEl && imageEl.src !== 'data:,' ? imageEl.src : '📦';
    const type = activeTab;

    const propertyInputs = document.querySelectorAll('#properties-list .property-input');
    const properties = Array.from(propertyInputs)
        .map(input => input.value.trim())
        .filter(value => value.length > 0);

    if (!name) {
        showToast('Please enter category name', 'error');
        return;
    }

    showLoading(true);

    try {
        console.log('💾 Saving category with properties:', properties);

        const { data, error } = await supabaseClient
            .from('categories')
            .insert([{
                name,
                description,
                image,
                type,
                properties
            }])
            .select();

        if (error) throw error;

        closeDialog();
        await refreshAllData();
        showToast('New category added successfully');

    } catch (error) {
        console.error('Error adding category:', error);
        showToast('Error adding category', 'error');
    } finally {
        showLoading(false);
    }
}

// ✅ UPDATED ADD ITEM FUNCTION WITH FORCE REFRESH
async function addItem() {
    const getDialogInputValue = (id) => {
        const element = document.querySelector(`#dialog-content input#${id}`);
        if (!element) {
            console.error(`❌ Dialog input not found: ${id}`);
            return null;
        }
        return element.value ? element.value.trim() : '';
    };

    const name = getDialogInputValue('item-name');
    const totalStr = getDialogInputValue('item-total');
    
    const propertyValueInputs = document.querySelectorAll('#item-property-values-list .item-property-value');
    const propertyValues = [];
    
    propertyValueInputs.forEach(input => {
        const propertyName = input.getAttribute('data-property-name');
        const value = input.value.trim();
        if (propertyName && value) {
            propertyValues.push({
                propertyName: propertyName,
                value: value
            });
        }
    });

    const propertyString = propertyValues.map(pv => `${pv.propertyName}: ${pv.value}`).join(', ');

    if (!name || name.length === 0) {
        showToast('Please enter item name', 'error');
        return;
    }

    const total = parseInt(totalStr, 10);
    if (isNaN(total) || total <= 0) {
        showToast('Please enter valid quantity', 'error');
        return;
    }

    if (!selectedCategory || !selectedCategory.id) {
        showToast('Please select a category first', 'error');
        return;
    }

    const imageEl = document.querySelector('#dialog-content img#item-image-preview');
    const image = (imageEl && imageEl.src && imageEl.src !== 'data:,') ? imageEl.src : null;

    showLoading(true);

    try {
        console.log('💾 Adding item:', name, 'to category:', selectedCategory.name);
        
        const { data, error } = await supabaseClient
            .from('items')
            .insert([{
                name: name,
                property: propertyString,           
                property_values: propertyValues,   
                total: total,
                available: total,
                category_id: selectedCategory.id,
                image: image
            }])
            .select();

        if (error) {
            console.error('❌ Supabase insert error:', error);
            showToast('Database error: ' + error.message, 'error');
            return;
        }

        console.log('✅ Item added successfully:', data);
        
        closeDialog();
        
        // ✅ FORCE REFRESH EVERYTHING
        await refreshAllData();
        
        showToast('Item added successfully', 'success');

    } catch (error) {
        console.error('💥 Unexpected error:', error);
        showToast('Unexpected error: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ✅ ISSUE ITEM WITH PERMANENT/TEMPORARY TYPE
async function issueItemWithType() {
    const memberId = parseInt(document.getElementById('issue-member').value);
    const quantity = parseInt(document.getElementById('issue-quantity').value);
    const issueType = document.querySelector('input[name="issue-type"]:checked')?.value || 'temporary';
    const expectedReturnDate = document.getElementById('expected-return-date')?.value;
    const purpose = document.getElementById('issue-purpose')?.value.trim() || '';

    if (!memberId || !quantity || quantity <= 0) {
        showToast('Please enter valid details', 'error');
        return;
    }

    if (quantity > selectedItem.available) {
        showToast('Cannot issue more than available quantity', 'error');
        return;
    }

    if (issueType === 'temporary' && !expectedReturnDate) {
        showToast('Please select expected return date for temporary issue', 'error');
        return;
    }

    showLoading(true);

    try {
        console.log('📋 Issuing item:', {
            item: selectedItem.name,
            member: memberId,
            quantity,
            type: issueType,
            returnDate: expectedReturnDate,
            purpose
        });

        const { error: issueError } = await supabaseClient
            .from('issued_items')
            .insert([{
                item_id: selectedItem.id,
                member_id: memberId,
                quantity: quantity,
                issue_type: issueType,
                expected_return_date: issueType === 'temporary' ? expectedReturnDate : null,
                purpose: purpose
            }])
            .select();

        if (issueError) throw issueError;

        // Update item availability
        const { error: updateError } = await supabaseClient
            .from('items')
            .update({
                available: selectedItem.available - quantity
            })
            .eq('id', selectedItem.id);

        if (updateError) throw updateError;

        closeDialog();
        
        // ✅ FORCE REFRESH
        await refreshAllData();
        
        // Re-show item detail with updated data
        const updatedItems = await fetchItems();
        selectedItem = updatedItems.find(item => item.id === selectedItem.id);
        if (selectedItem) {
            showItemDetail(selectedItem);
        }

        showToast(`Item issued successfully (${issueType})`, 'success');

    } catch (error) {
        console.error('❌ Error issuing item:', error);
        showToast('Error issuing item', 'error');
    } finally {
        showLoading(false);
    }
}

async function returnItem(issuedItemId, quantity) {
    const confirmed = await showConfirmDialog('Are you sure you want to return this item?', true);
    if (!confirmed) return;

    showLoading(true);

    try {
        const { error: returnError } = await supabaseClient
            .from('issued_items')
            .update({
                status: 'returned',
                returned_date: new Date().toISOString()
            })
            .eq('id', issuedItemId);

        if (returnError) throw returnError;

        if (selectedItem) {
            const { error: updateError } = await supabaseClient
                .from('items')
                .update({
                    available: selectedItem.available + quantity
                })
                .eq('id', selectedItem.id);

            if (updateError) throw updateError;

            const updatedItems = await fetchItems();
            selectedItem = updatedItems.find(item => item.id === selectedItem.id);
            if (selectedItem) {
                showItemDetail(selectedItem);
            }
        }

        await refreshData();
        populateCurrentIssuesTable();
        populateHistoryTable();
        showToast('Item returned successfully');

    } catch (error) {
        console.error('Error returning item:', error);
        showToast('Error returning item', 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteMember(memberId) {
    const confirmed = await showConfirmDialog('Are you sure you want to delete this member?');
    if (!confirmed) return;

    showLoading(true);

    try {
        const { error } = await supabaseClient
            .from('members')
            .delete()
            .eq('id', memberId);

        if (error) throw error;

        await refreshAllData();
        showToast('Member deleted successfully');

    } catch (error) {
        console.error('Error deleting member:', error);
        showToast('Error deleting member', 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteCategory(categoryId) {
    const confirmed = await showConfirmDialog('Are you sure you want to delete this category?');
    if (!confirmed) return;

    showLoading(true);

    try {
        const { error } = await supabaseClient
            .from('categories')
            .delete()
            .eq('id', categoryId);

        if (error) throw error;

        await refreshAllData();
        showToast('Category deleted successfully');

    } catch (error) {
        console.error('Error deleting category:', error);
        showToast('Error deleting category', 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteItem(itemId) {
    const confirmed = await showConfirmDialog('Are you sure you want to delete this item?');
    if (!confirmed) return;

    showLoading(true);

    try {
        const { error } = await supabaseClient
            .from('items')
            .delete()
            .eq('id', itemId);

        if (error) throw error;

        await refreshAllData();
        showToast('Item deleted successfully');

    } catch (error) {
        console.error('Error deleting item:', error);
        showToast('Error deleting item', 'error');
    } finally {
        showLoading(false);
    }
}

// Navigation Functions
function setActiveSection(section) {
    console.log('Navigating to:', section);
    activeSection = section;

    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

    const targetSection = document.getElementById(section + '-section');
    if (targetSection) {
        targetSection.classList.remove('hidden');
    } else {
        console.error('Section not found:', section);
        return;
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.section === section) {
            btn.classList.add('bg-blue-600');
            btn.classList.remove('hover:bg-gray-700');
        } else {
            btn.classList.remove('bg-blue-600');
            btn.classList.add('hover:bg-gray-700');
        }
    });

    try {
        if (section === 'members') {
            populateMembersTable();
        } else if (section === 'components') {
            showCategoriesView();
            populateCategories();
        } else if (section === 'admin') {
            setActiveAdminTab(activeAdminTab);
        } else if (section === 'dashboard') {
            updateStats();
        } else if (section === 'low-stock') {
            showLowStockPage();
        }
    } catch (error) {
        console.error('Error loading section data:', error);
        showToast('Error loading data', 'error');
    }
}

function setActiveTab(tab) {
    activeTab = tab;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.className = 'tab-btn pb-2 px-1 border-b-2 border-blue-500 text-blue-600 font-semibold';
        } else {
            btn.className = 'tab-btn pb-2 px-1 text-gray-500';
        }
    });

    populateCategories();
}

async function updateStats() {
    try {
        const members = await fetchMembers();
        const items = await fetchItems();
        let totalQuantity = 0;
        let availableQuantity = 0;
        let lowStockItems = 0;

        items.forEach(item => {
            totalQuantity += item.total || 0;
            availableQuantity += item.available || 0;
            if (item.available <= 5) {
                lowStockItems++;
            }
        });

        const issuedItems = Math.max(0, totalQuantity - availableQuantity);

        const totalMembersEl = document.getElementById('total-members');
        const totalItemsEl = document.getElementById('total-items');
        const issuedItemsEl = document.getElementById('issued-items');
        const availableItemsEl = document.getElementById('available-items');
        const lowStockItemsEl = document.getElementById('low-stock-items');

        if (totalMembersEl) totalMembersEl.textContent = members.length;
        if (totalItemsEl) totalItemsEl.textContent = items.length;
        if (issuedItemsEl) issuedItemsEl.textContent = issuedItems;
        if (availableItemsEl) availableItemsEl.textContent = availableQuantity;
        if (lowStockItemsEl) lowStockItemsEl.textContent = lowStockItems;

    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

async function populateMembersTable() {
    const tbody = document.getElementById('members-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="p-3 text-center">Loading...</td></tr>';

    try {
        const members = await fetchMembers();
        tbody.innerHTML = '';

        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="p-3 text-center text-gray-500">No members found</td></tr>';
            return;
        }

        members.forEach(member => {
            const row = document.createElement('tr');
            row.className = 'border-t hover:bg-gray-50 cursor-pointer';

            const photoHTML = member.photo ?
                createImagePreview(member.photo, 'small', true) :
                '<div class="profile-image bg-gray-200 flex items-center justify-center"><i data-lucide="user" class="w-6 h-6 text-gray-400"></i></div>';

            row.innerHTML = `
                <td class="p-3">${photoHTML}</td>
                <td class="p-3 text-blue-600 font-medium hover:underline" onclick="showMemberDetails(${member.id})">${member.name}</td>
                <td class="p-3">${member.batch}</td>
                <td class="p-3">${member.branch}</td>
                <td class="p-3">${member.year}</td>
                <td class="p-3">${member.contact}</td>
                <td class="p-3">
                    <div class="flex gap-2">
                        <button onclick="event.stopPropagation(); deleteMember(${member.id})" class="text-red-500 hover:bg-red-50 p-1 rounded">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });

        lucide.createIcons();

    } catch (error) {
        console.error('Error in populateMembersTable:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="p-3 text-center text-red-500">Error loading members</td></tr>';
        showToast('Error loading members', 'error');
    }
}

async function populateCategories() {
    const grid = document.getElementById('categories-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="col-span-full text-center p-8">Loading categories...</div>';

    try {
        const categories = await fetchCategories();
        const filteredCategories = categories.filter(cat => cat.type === activeTab);

        grid.innerHTML = '';

        if (filteredCategories.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center p-8 text-gray-500">No categories found</div>';
            return;
        }

        for (const category of filteredCategories) {
            const items = await fetchItems(category.id);
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'border rounded-lg p-6 text-center hover:shadow-md cursor-pointer transition-shadow hover-lift relative group';

            const displayImage = category.image && (category.image.startsWith('data:') || category.image.startsWith('http')) ?
                `<img src="${category.image}" class="category-image mx-auto mb-3" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><div class="text-4xl mb-3" style="display:none;">📦</div>` :
                `<div class="text-4xl mb-3">${category.image || '📦'}</div>`;

            const descriptionHTML = category.description ?
                `<p class="text-xs text-gray-400 mb-2 line-clamp-2">${category.description}</p>` : '';

            const propertiesHTML = category.properties && category.properties.length > 0 ?
                `<p class="text-xs text-blue-500 mb-2">Properties: ${category.properties.join(', ')}</p>` : '';

            categoryDiv.innerHTML = `
                <div onclick="showItemsView(${JSON.stringify(category).replace(/"/g, '&quot;')})">
                    ${displayImage}
                    <h3 class="font-semibold mb-2">${category.name}</h3>
                    ${descriptionHTML}
                    ${propertiesHTML}
                    <p class="text-sm text-gray-500">${items.length} items</p>
                </div>
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div class="relative">
                        <button onclick="event.stopPropagation(); toggleMenu('category-menu-${category.id}')" class="p-1 hover:bg-gray-200 rounded">
                            <i data-lucide="more-vertical" class="w-4 h-4"></i>
                        </button>
                        <div id="category-menu-${category.id}" class="dropdown-menu">
                            <button onclick="editCategory(${category.id})" class="dropdown-item">
                                <i data-lucide="edit" class="w-4 h-4 inline mr-2"></i>Edit
                            </button>
                            <button onclick="deleteCategory(${category.id})" class="dropdown-item delete">
                                <i data-lucide="trash-2" class="w-4 h-4 inline mr-2"></i>Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
            grid.appendChild(categoryDiv);
        }

        lucide.createIcons();

    } catch (error) {
        console.error('Error in populateCategories:', error);
        grid.innerHTML = '<div class="col-span-full text-center p-8 text-red-500">Error loading categories</div>';
        showToast('Error loading categories', 'error');
    }
}

async function populateItems(categoryId) {
    const grid = document.getElementById('items-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="col-span-full text-center p-8">Loading items...</div>';

    try {
        const items = await fetchItems(categoryId);
        grid.innerHTML = '';

        if (items.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center p-8 text-gray-500">No items found in this category</div>';
            return;
        }

        items.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'border rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow hover-lift relative group';

            const displayImage = item.image ?
                `<img src="${item.image}" class="w-16 h-16 object-cover rounded mb-2 mx-auto" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><div class="text-3xl mb-2 text-center hidden">🔌</div>` :
                '<div class="text-3xl mb-2 text-center">🔌</div>';

            let propertyHTML = '';
            if (item.property) {
                propertyHTML = `<p class="text-xs text-blue-600 mb-1">Properties: ${item.property}</p>`;
            }

            itemDiv.innerHTML = `
                <div onclick="showItemDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    ${displayImage}
                    <h3 class="font-semibold mb-2 text-center">${item.name}</h3>
                    ${propertyHTML}
                    <div class="text-sm text-gray-600 text-center">
                        <p>Available: <span class="font-semibold text-green-600">${item.available}</span></p>
                        <p>Total: <span class="font-semibold">${item.total}</span></p>
                    </div>
                </div>
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div class="relative">
                        <button onclick="event.stopPropagation(); toggleMenu('item-menu-${item.id}')" class="p-1 hover:bg-gray-200 rounded">
                            <i data-lucide="more-vertical" class="w-4 h-4"></i>
                        </button>
                        <div id="item-menu-${item.id}" class="dropdown-menu">
                            <button onclick="editItem(${item.id})" class="dropdown-item">
                                <i data-lucide="edit" class="w-4 h-4 inline mr-2"></i>Edit
                            </button>
                            <button onclick="deleteItem(${item.id})" class="dropdown-item delete">
                                <i data-lucide="trash-2" class="w-4 h-4 inline mr-2"></i>Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
            grid.appendChild(itemDiv);
        });

        lucide.createIcons();

    } catch (error) {
        console.error('Error in populateItems:', error);
        grid.innerHTML = '<div class="col-span-full text-center p-8 text-red-500">Error loading items</div>';
        showToast('Error loading items', 'error');
    }
}

async function populateCurrentIssuesTable() {
    const tbody = document.getElementById('current-issues-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="p-3 text-center">Loading...</td></tr>';

    try {
        const currentIssues = await fetchCurrentIssues();
        tbody.innerHTML = '';

        if (currentIssues.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-3 text-center text-gray-500">No currently issued items</td></tr>';
            return;
        }

        currentIssues.forEach(issued => {
            const row = document.createElement('tr');
            row.className = 'border-t';
            const issueDate = new Date(issued.issued_date).toLocaleDateString('en-US');

            const itemImage = issued.items?.image ?
                createImagePreview(issued.items.image, 'small') :
                '<div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center"><i data-lucide="package" class="w-6 h-6 text-gray-400"></i></div>';

            const memberPhoto = issued.members?.photo ?
                createImagePreview(issued.members.photo, 'small', true) :
                '<div class="profile-image bg-gray-200 flex items-center justify-center"><i data-lucide="user" class="w-6 h-6 text-gray-400"></i></div>';

            row.innerHTML = `
                <td class="p-3">${itemImage}</td>
                <td class="p-3">${issued.items?.name || 'Unknown'}</td>
                <td class="p-3">${issued.members?.name || 'Unknown'}</td>
                <td class="p-3">${memberPhoto}</td>
                <td class="p-3">${issued.members?.branch || 'Unknown'}</td>
                <td class="p-3">${issued.quantity}</td>
                <td class="p-3">${issueDate}</td>
                <td class="p-3">
                    <button onclick="smartReturn(${issued.member_id}, '${issued.members?.name || 'Unknown'}')" class="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600">
                        Return
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        lucide.createIcons();

    } catch (error) {
        console.error('Error in populateCurrentIssuesTable:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="p-3 text-center text-red-500">Error loading current issues</td></tr>';
        showToast('Error loading current issues', 'error');
    }
}

async function populateHistoryTable() {
    const tbody = document.getElementById('history-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" class="p-3 text-center">Loading...</td></tr>';

    try {
        const history = await fetchHistory();
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="p-3 text-center text-gray-500">No returned items found</td></tr>';
            return;
        }

        history.forEach(issued => {
            const row = document.createElement('tr');
            row.className = 'border-t';
            const issueDate = new Date(issued.issued_date).toLocaleDateString('en-US');
            const returnDate = new Date(issued.returned_date).toLocaleDateString('en-US');

            const issueDateObj = new Date(issued.issued_date);
            const returnDateObj = new Date(issued.returned_date);
            const diffTime = Math.abs(returnDateObj - issueDateObj);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            const itemImage = issued.items?.image ?
                createImagePreview(issued.items.image, 'small') :
                '<div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center"><i data-lucide="package" class="w-6 h-6 text-gray-400"></i></div>';

            const memberPhoto = issued.members?.photo ?
                createImagePreview(issued.members.photo, 'small', true) :
                '<div class="profile-image bg-gray-200 flex items-center justify-center"><i data-lucide="user" class="w-6 h-6 text-gray-400"></i></div>';

            row.innerHTML = `
                <td class="p-3">${itemImage}</td>
                <td class="p-3">${issued.items?.name || 'Unknown'}</td>
                <td class="p-3">${issued.members?.name || 'Unknown'}</td>
                <td class="p-3">${memberPhoto}</td>
                <td class="p-3">${issued.members?.branch || 'Unknown'}</td>
                <td class="p-3">${issued.quantity}</td>
                <td class="p-3">${issueDate}</td>
                <td class="p-3">${returnDate}</td>
                <td class="p-3"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">${diffDays} days</span></td>
            `;
            tbody.appendChild(row);
        });

        lucide.createIcons();

    } catch (error) {
        console.error('Error in populateHistoryTable:', error);
        tbody.innerHTML = '<tr><td colspan="9" class="p-3 text-center text-red-500">Error loading history</td></tr>';
        showToast('Error loading history', 'error');
    }
}

// Search Functions
const searchMembers = () => {
    const term = document.getElementById('search-members').value.toLowerCase();
    const rows = document.querySelectorAll('#members-table-body tr');
    rows.forEach(row => {
        if (row.cells.length < 2) return;
        const name = row.cells[1].textContent.toLowerCase();
        const branch = row.cells[3].textContent.toLowerCase();
        row.style.display = (name.includes(term) || branch.includes(term)) ? '' : 'none';
    });
};

const searchIssues = () => {
    const term = document.getElementById('search-issues').value.toLowerCase();
    const rows = document.querySelectorAll('#current-issues-table tr');
    rows.forEach(row => {
        if (row.cells.length < 3) return;
        const item = row.cells[1].textContent.toLowerCase();
        const member = row.cells[2].textContent.toLowerCase();
        row.style.display = (item.includes(term) || member.includes(term)) ? '' : 'none';
    });
};

const filterIssueMembers = () => {
    const term = document.getElementById('search-issue-members').value.toLowerCase();
    const select = document.getElementById('issue-member');
    const options = select.querySelectorAll('option');
    options.forEach(opt => {
        if (opt.value === '') return;
        opt.style.display = opt.textContent.toLowerCase().includes(term) ? '' : 'none';
    });
};

// View Functions
function showCategoriesView() {
    const categoriesView = document.getElementById('categories-view');
    const itemsView = document.getElementById('items-view');
    const itemDetailView = document.getElementById('item-detail-view');

    if (categoriesView) categoriesView.classList.remove('hidden');
    if (itemsView) itemsView.classList.add('hidden');
    if (itemDetailView) itemDetailView.classList.add('hidden');

    selectedCategory = null;
    selectedItem = null;
}

function showItemsView(category) {
    selectedCategory = category;

    const categoriesView = document.getElementById('categories-view');
    const itemsView = document.getElementById('items-view');
    const itemDetailView = document.getElementById('item-detail-view');

    if (categoriesView) categoriesView.classList.add('hidden');
    if (itemsView) itemsView.classList.remove('hidden');
    if (itemDetailView) itemDetailView.classList.add('hidden');

    if (category) {
        const categoryTitle = document.getElementById('category-title');
        if (categoryTitle) categoryTitle.textContent = category.name;
        populateItems(category.id);
    }
}

async function showItemDetail(item) {
    selectedItem = item;

    const categoriesView = document.getElementById('categories-view');
    const itemsView = document.getElementById('items-view');
    const itemDetailView = document.getElementById('item-detail-view');

    if (categoriesView) categoriesView.classList.add('hidden');
    if (itemsView) itemsView.classList.add('hidden');
    if (itemDetailView) itemDetailView.classList.remove('hidden');

    const itemNameEl = document.getElementById('item-name');
    const itemAvailableEl = document.getElementById('item-available');
    const itemTotalEl = document.getElementById('item-total');
    const itemPropertyEl = document.getElementById('item-property');

    if (itemNameEl) itemNameEl.textContent = item.name;
    if (itemAvailableEl) itemAvailableEl.textContent = item.available;
    if (itemTotalEl) itemTotalEl.textContent = item.total;
    if (itemPropertyEl) itemPropertyEl.textContent = item.property || 'Not specified';

    const imageContainer = document.getElementById('item-image-container');
    if (imageContainer) {
        if (item.image) {
            imageContainer.innerHTML = `<img src="${item.image}" class="w-full h-full object-cover rounded-lg" onerror="this.style.display='none'">`;
        } else {
            imageContainer.innerHTML = '<span class="text-6xl">🔌</span>';
        }
    }

    try {
        const { data: issuedItems } = await supabaseClient
            .from('issued_items')
            .select(`
                *,
                members(name, branch)
            `)
            .eq('item_id', item.id)
            .eq('status', 'issued');

        const issuedList = document.getElementById('issued-list');
        if (issuedList) {
            issuedList.innerHTML = '';

            if (issuedItems && issuedItems.length > 0) {
                issuedItems.forEach(issued => {
                    const issueDiv = document.createElement('div');
                    issueDiv.className = 'flex justify-between items-center p-2 bg-gray-50 rounded';
                    issueDiv.innerHTML = `
                        <div>
                            <p class="font-medium">${issued.members.name}</p>
                            <p class="text-sm text-gray-500">${issued.members.branch}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-semibold">Qty: ${issued.quantity}</p>
                            <button onclick="returnItem(${issued.id}, ${issued.quantity})" class="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600">
                                Return
                            </button>
                        </div>
                    `;
                    issuedList.appendChild(issueDiv);
                });
            } else {
                issuedList.innerHTML = '<p class="text-gray-500 text-center py-4">No items currently issued</p>';
            }
        }
    } catch (error) {
        console.error('Error loading issued items:', error);
        const issuedList = document.getElementById('issued-list');
        if (issuedList) {
            issuedList.innerHTML = '<p class="text-red-500 text-center py-4">Error loading issued items</p>';
        }
    }
}

// ✅ UPDATED OPEN DIALOG WITH ISSUE TYPE SUPPORT
async function openDialog(type) {
    const dialog = document.getElementById('dialog-backdrop');
    const title = document.getElementById('dialog-title');
    const content = document.getElementById('dialog-content');

    if (!dialog || !title || !content) return;

    dialog.classList.remove('hidden');

    if (type === 'addMember') {
        title.textContent = 'Add New Member';
        content.innerHTML = `
            <div class="space-y-4">
                <div class="text-center">
                    <label for="member-photo-input" class="image-upload-area w-24 h-24 mx-auto rounded-full overflow-hidden border-2 flex items-center justify-center bg-gray-50 cursor-pointer">
                        <img id="member-photo-preview" src="data:," class="w-full h-full object-cover hidden">
                        <div id="member-photo-placeholder" class="text-center">
                            <i data-lucide="camera" class="w-8 h-8 mx-auto text-gray-400 mb-1"></i>
                            <p class="text-xs text-gray-500">Add Photo</p>
                        </div>
                    </label>
                    <input type="file" id="member-photo-input" accept="image/*" class="hidden" onchange="handleMemberPhoto(this)">
                </div>
                <input type="text" placeholder="Name" id="member-name" class="w-full p-2 border rounded" required />
                <input type="text" placeholder="Batch (e.g., 2023)" id="member-batch" class="w-full p-2 border rounded" required />
                <input type="text" placeholder="Branch (e.g., CSE)" id="member-branch" class="w-full p-2 border rounded" required />
                <input type="text" placeholder="Year (e.g., 2nd)" id="member-year" class="w-full p-2 border rounded" required />
                <input type="tel" placeholder="Contact (10 digits)" id="member-contact" class="w-full p-2 border rounded" required />
                <textarea placeholder="Address" id="member-address" class="w-full p-2 border rounded" rows="3"></textarea>
                <button onclick="addMember()" class="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600">
                    Add Member
                </button>
            </div>
        `;
    } else if (type === 'addCategory') {
        title.textContent = 'Add New Category';
        content.innerHTML = `
            <div class="space-y-4">
                <div class="text-center">
                    <label for="category-image-input" class="image-upload-area w-20 h-20 mx-auto rounded-lg overflow-hidden border-2 flex items-center justify-center bg-gray-50 cursor-pointer">
                        <img id="category-image-preview" src="data:," class="w-full h-full object-cover hidden">
                        <div id="category-image-placeholder" class="text-center">
                            <div class="text-2xl mb-1">📦</div>
                            <p class="text-xs text-gray-500">Add Icon</p>
                        </div>
                    </label>
                    <input type="file" id="category-image-input" accept="image/*" class="hidden" onchange="handleCategoryImage(this)">
                </div>
                <input type="text" placeholder="Category Name" id="category-name" class="w-full p-2 border rounded" required />
                <textarea placeholder="Description (optional)" id="category-description" class="w-full p-2 border rounded" rows="3"></textarea>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Properties:</label>
                    <div id="properties-list" class="space-y-2">
                        <div class="flex items-center gap-2">
                            <input type="text" class="property-input flex-1 p-2 border rounded" placeholder="Property name (e.g., Voltage)">
                            <button type="button" onclick="removePropertyInput(this)" class="property-remove-btn">×</button>
                        </div>
                    </div>
                    <button type="button" onclick="addPropertyInput('properties-list')" class="mt-2 text-blue-500 hover:underline text-sm">+ Add Property</button>
                </div>
                
                <p class="text-sm text-gray-500">Category Type: <strong>${activeTab === 'consumable' ? 'Consumable' : 'Non-Consumable'}</strong></p>
                <button onclick="addCategory()" class="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                    Add Category
                </button>
            </div>
        `;
    } else if (type === 'addItem') {
        title.textContent = 'Add New Item';
        
        let categoryPropertiesHTML = '';
        if (selectedCategory && selectedCategory.properties && selectedCategory.properties.length > 0) {
            categoryPropertiesHTML = selectedCategory.properties.map(prop => `
                <div class="flex items-center gap-2 bg-blue-50 p-2 rounded border property-value-row">
                    <label class="w-24 text-sm font-medium">${prop}:</label>
                    <input type="text" 
                           class="item-property-value flex-1 p-2 border rounded" 
                           data-property-name="${prop}" 
                           placeholder="Enter ${prop} value (e.g., 10k, 5V)">
                    <button type="button" onclick="removePropertyValueRow(this)" class="text-red-500 hover:bg-red-100 p-1 rounded" title="Remove">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            `).join('');
        }
        
        content.innerHTML = `
            <div class="space-y-4">
                <div class="text-center">
                    <label for="item-image-input" class="image-upload-area w-24 h-24 mx-auto rounded-lg overflow-hidden border-2 flex items-center justify-center bg-gray-50 cursor-pointer">
                        <img id="item-image-preview" src="data:," class="w-full h-full object-cover hidden">
                        <div id="item-image-placeholder" class="text-center">
                            <i data-lucide="image" class="w-8 h-8 mx-auto text-gray-400 mb-1"></i>
                            <p class="text-xs text-gray-500">Add Image</p>
                        </div>
                    </label>
                    <input type="file" id="item-image-input" accept="image/*" class="hidden" onchange="handleItemImage(this)">
                </div>
                <input type="text" placeholder="Item Name" id="item-name" class="w-full p-2 border rounded" required />
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Property Values:</label>
                    <div id="item-property-values-list" class="space-y-2">
                        ${categoryPropertiesHTML}
                    </div>
                    <button type="button" onclick="addCustomPropertyValue()" class="mt-2 text-blue-500 hover:underline text-sm">+ Add Custom Property</button>
                </div>
                
                <input type="number" placeholder="Total Quantity" id="item-total" class="w-full p-2 border rounded" min="1" required />
                <p class="text-sm text-gray-500">Category: <strong>${selectedCategory ? selectedCategory.name : ''}</strong></p>
                <button onclick="addItem()" class="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                    Add Item
                </button>
            </div>
        `;
        
    } else if (type === 'issueItem') {
        try {
            const members = await fetchMembers();
            title.textContent = 'Issue Item';
            content.innerHTML = `
                <div class="space-y-4">
                    <input type="text" placeholder="Search members..." id="search-issue-members" 
                           class="w-full p-2 border rounded" oninput="filterIssueMembers()">
                    
                    <select id="issue-member" class="w-full p-2 border rounded" required>
                        <option value="">Select Member</option>
                        ${members.map(member => `<option value="${member.id}">${member.name} (${member.branch})</option>`).join('')}
                    </select>
                    
                    <input type="number" placeholder="Quantity" id="issue-quantity" 
                           class="w-full p-2 border rounded" min="1" max="${selectedItem ? selectedItem.available : 0}" required />
                    
                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-gray-700">Issue Type:</label>
                        <div class="flex gap-4">
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="radio" name="issue-type" value="temporary" checked 
                                       class="text-blue-600 focus:ring-blue-500" id="issue-temporary">
                                <span class="text-sm">Temporary Issue</span>
                            </label>
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="radio" name="issue-type" value="permanent" 
                                       class="text-blue-600 focus:ring-blue-500" id="issue-permanent">
                                <span class="text-sm">Permanent Issue</span>
                            </label>
                        </div>
                    </div>

                    <div id="return-date-container" class="space-y-2">
                        <label class="block text-sm font-medium text-gray-700">Expected Return Date:</label>
                        <input type="date" id="expected-return-date" class="w-full p-2 border rounded"
                               min="${new Date().toISOString().split('T')[0]}">
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-gray-700">Purpose/Reason:</label>
                        <textarea id="issue-purpose" class="w-full p-2 border rounded" rows="2" 
                                  placeholder="Brief reason for issuing this item..."></textarea>
                    </div>
                    
                    <p class="text-sm text-gray-500">Available: ${selectedItem ? selectedItem.available : 0}</p>
                    
                    <button onclick="issueItemWithType()" 
                            class="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                        Issue Item
                    </button>
                </div>
            `;

            setTimeout(() => {
                const temporaryRadio = document.getElementById('issue-temporary');
                const permanentRadio = document.getElementById('issue-permanent');
                const returnDateContainer = document.getElementById('return-date-container');

                function toggleReturnDate() {
                    if (permanentRadio && permanentRadio.checked) {
                        returnDateContainer.style.display = 'none';
                    } else {
                        returnDateContainer.style.display = 'block';
                    }
                }

                if (temporaryRadio && permanentRadio) {
                    temporaryRadio.addEventListener('change', toggleReturnDate);
                    permanentRadio.addEventListener('change', toggleReturnDate);
                }
            }, 100);

        } catch (error) {
            console.error('Error loading members for issue dialog:', error);
            content.innerHTML = '<div class="text-center text-red-500">Error loading members</div>';
        }
    }

    lucide.createIcons();
}

function closeDialog() {
    const dialog = document.getElementById('dialog-backdrop');
    if (dialog) {
        dialog.classList.add('hidden');
    }
}

function setupNavigationListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const section = btn.dataset.section;
            if (section && section !== activeSection) {
                setActiveSection(section);
            }
        });
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = btn.dataset.tab;
            if (tab && tab !== activeTab) {
                setActiveTab(tab);
            }
        });
    });
}

async function init() {
    if (isInitialized) return;
    isInitialized = true;

    try {
        console.log('🚀 Initializing enhanced inventory system with all new features - ONCE');
        lucide.createIcons();
        setupNavigationListeners();
        setActiveSection('dashboard');

        if (!authListenerSetup) {
            authListenerSetup = true;
            supabaseClient.auth.onAuthStateChange((event, session) => {
                console.log(`Auth state changed: ${event}`);
                if (event === 'SIGNED_IN' && !currentUser) {
                    currentUser = session.user;
                    showMainApp();
                } else if (event === 'SIGNED_OUT') {
                    currentUser = null;
                    isInitialized = false;
                    authListenerSetup = false;
                    showAuthModal();
                }
            });
        }

        console.log('✅ Enhanced inventory system with all new features initialized successfully!');
    } catch (error) {
        console.error('💥 Error initializing app:', error);
        isInitialized = false;
        showToast('App initialization error', 'error');
    }
}

// Page Load Handler
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        lucide.createIcons();
        showSplashAndInit();
    });
} else {
    lucide.createIcons();
    showSplashAndInit();
}
