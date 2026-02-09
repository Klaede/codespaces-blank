/**
 * Google Apps Script Backend for Dyesabel PH Authentication
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to script.google.com and create a new project
 * 2. Copy this code into Code.gs
 * 3. Create a Google Sheet to store user data
 * 4. Update SPREADSHEET_ID with your sheet ID
 * 5. Deploy as Web App:
 *    - Click Deploy > New deployment
 *    - Select type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Click Deploy and copy the web app URL
 * 6. Update the GAS_API_URL in AuthContext.tsx with your deployment URL
 */

// ============================================
// CONFIGURATION
// ============================================

// Replace with your Google Sheet ID
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
const USERS_SHEET_NAME = 'Users';
const SESSIONS_SHEET_NAME = 'Sessions';

// Session timeout (24 hours in milliseconds)
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;

// ============================================
// MAIN HANDLER
// ============================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    switch(data.action) {
      case 'login':
        return handleLogin(data.username, data.password);
      case 'logout':
        return handleLogout(data.sessionToken);
      case 'validateSession':
        return handleValidateSession(data.sessionToken);
      default:
        return createResponse(false, 'Invalid action');
    }
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return createResponse(false, 'Server error: ' + error.toString());
  }
}

function doGet(e) {
  return ContentService.createTextOutput('Dyesabel PH Authentication API is running');
}

// ============================================
// AUTHENTICATION HANDLERS
// ============================================

function handleLogin(username, password) {
  try {
    // Get users sheet
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
    
    // Create users sheet if it doesn't exist
    if (!usersSheet) {
      usersSheet = createUsersSheet(ss);
    }
    
    // Get all users
    const data = usersSheet.getDataRange().getValues();
    
    // Skip header row and find user
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === username && row[1] === password) {
        // User found - create session
        const sessionToken = generateSessionToken();
        const user = {
          id: row[4] || Utilities.getUuid(),
          username: row[0],
          email: row[2],
          role: row[3],
          chapterId: row[5] || null
        };
        
        // Store session
        storeSession(sessionToken, user);
        
        return createResponse(true, 'Login successful', {
          user: user,
          sessionToken: sessionToken
        });
      }
    }
    
    // User not found or wrong password
    return createResponse(false, 'Invalid username or password');
    
  } catch (error) {
    Logger.log('Error in handleLogin: ' + error.toString());
    return createResponse(false, 'Login error: ' + error.toString());
  }
}

function handleLogout(sessionToken) {
  try {
    // Remove session
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
    
    if (sessionsSheet) {
      const data = sessionsSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === sessionToken) {
          sessionsSheet.deleteRow(i + 1);
          break;
        }
      }
    }
    
    return createResponse(true, 'Logged out successfully');
  } catch (error) {
    Logger.log('Error in handleLogout: ' + error.toString());
    return createResponse(false, 'Logout error: ' + error.toString());
  }
}

function handleValidateSession(sessionToken) {
  try {
    const session = getSession(sessionToken);
    
    if (session && !isSessionExpired(session)) {
      return createResponse(true, 'Session valid', {
        user: JSON.parse(session.userData)
      });
    }
    
    return createResponse(false, 'Invalid or expired session');
  } catch (error) {
    Logger.log('Error in handleValidateSession: ' + error.toString());
    return createResponse(false, 'Validation error: ' + error.toString());
  }
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function storeSession(sessionToken, user) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sessionsSheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
  
  // Create sessions sheet if it doesn't exist
  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet(SESSIONS_SHEET_NAME);
    sessionsSheet.appendRow(['Session Token', 'User Data', 'Created At', 'Expires At']);
  }
  
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT);
  
  sessionsSheet.appendRow([
    sessionToken,
    JSON.stringify(user),
    now.toISOString(),
    expiresAt.toISOString()
  ]);
  
  // Clean up old sessions
  cleanupExpiredSessions();
}

function getSession(sessionToken) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
  
  if (!sessionsSheet) return null;
  
  const data = sessionsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sessionToken) {
      return {
        sessionToken: data[i][0],
        userData: data[i][1],
        createdAt: data[i][2],
        expiresAt: data[i][3]
      };
    }
  }
  
  return null;
}

function isSessionExpired(session) {
  const expiresAt = new Date(session.expiresAt);
  return expiresAt < new Date();
}

function cleanupExpiredSessions() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
  
  if (!sessionsSheet) return;
  
  const data = sessionsSheet.getDataRange().getValues();
  const now = new Date();
  
  // Delete from bottom to top to avoid index issues
  for (let i = data.length - 1; i >= 1; i--) {
    const expiresAt = new Date(data[i][3]);
    if (expiresAt < now) {
      sessionsSheet.deleteRow(i + 1);
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateSessionToken() {
  return Utilities.getUuid() + '_' + new Date().getTime();
}

function createResponse(success, message, data = null) {
  const response = {
    success: success,
    message: message
  };
  
  if (data) {
    Object.assign(response, data);
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function createUsersSheet(ss) {
  const usersSheet = ss.insertSheet(USERS_SHEET_NAME);
  
  // Add header row
  usersSheet.appendRow(['Username', 'Password', 'Email', 'Role', 'User ID', 'Chapter ID']);
  
  // Add default users (CHANGE THESE IN PRODUCTION!)
  usersSheet.appendRow([
    'admin',
    'admin123',
    'admin@dyesabel.org',
    'admin',
    Utilities.getUuid(),
    ''
  ]);
  
  usersSheet.appendRow([
    'chapter1',
    'chapter123',
    'chapter1@dyesabel.org',
    'chapter_head',
    Utilities.getUuid(),
    'quezon-city'
  ]);
  
  usersSheet.appendRow([
    'editor',
    'editor123',
    'editor@dyesabel.org',
    'editor',
    Utilities.getUuid(),
    ''
  ]);
  
  return usersSheet;
}

// ============================================
// ADMIN FUNCTIONS (Call these from Script Editor)
// ============================================

/**
 * Add a new user
 * Run this function from the Script Editor to add users
 */
function addUser(username, password, email, role, chapterId = '') {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  
  if (!usersSheet) {
    Logger.log('Users sheet not found. Please initialize the system first.');
    return;
  }
  
  const userId = Utilities.getUuid();
  usersSheet.appendRow([username, password, email, role, userId, chapterId]);
  
  Logger.log('User added successfully: ' + username);
}

/**
 * Initialize the system - creates necessary sheets and default users
 */
function initializeSystem() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Create users sheet if it doesn't exist
  let usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!usersSheet) {
    usersSheet = createUsersSheet(ss);
    Logger.log('Users sheet created with default users');
  } else {
    Logger.log('Users sheet already exists');
  }
  
  // Create sessions sheet if it doesn't exist
  let sessionsSheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet(SESSIONS_SHEET_NAME);
    sessionsSheet.appendRow(['Session Token', 'User Data', 'Created At', 'Expires At']);
    Logger.log('Sessions sheet created');
  } else {
    Logger.log('Sessions sheet already exists');
  }
  
  Logger.log('System initialization complete!');
}

/**
 * List all users
 */
function listUsers() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  
  if (!usersSheet) {
    Logger.log('Users sheet not found');
    return;
  }
  
  const data = usersSheet.getDataRange().getValues();
  Logger.log('Users:');
  for (let i = 1; i < data.length; i++) {
    Logger.log('- ' + data[i][0] + ' (' + data[i][3] + ')');
  }
}
