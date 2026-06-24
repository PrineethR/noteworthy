/**
 * google.js - Google OAuth 2.0 and API integration for Noteworthy
 */

export function getStoredToken() {
    const token = localStorage.getItem('nw_google_access_token');
    const expiry = localStorage.getItem('nw_google_token_expiry');
    if (!token || !expiry) return null;
    
    // Check if expired (or within 1 minute of expiring)
    if (Date.now() > parseInt(expiry, 10) - 60000) {
        clearStoredToken();
        return null;
    }
    return token;
}

export function clearStoredToken() {
    localStorage.removeItem('nw_google_access_token');
    localStorage.removeItem('nw_google_token_expiry');
}

export function requestGoogleToken(clientId) {
    return new Promise((resolve, reject) => {
        if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
            reject(new Error("Google Identity Services SDK not loaded yet."));
            return;
        }

        try {
            const tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/documents',
                callback: (response) => {
                    if (response.error) {
                        reject(response);
                    } else {
                        localStorage.setItem('nw_google_access_token', response.access_token);
                        // Expires in seconds, store absolute expiry time
                        const expiryTime = Date.now() + (parseInt(response.expires_in, 10) * 1000);
                        localStorage.setItem('nw_google_token_expiry', expiryTime.toString());
                        resolve(response.access_token);
                    }
                },
                error_callback: (err) => {
                    reject(err);
                }
            });
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Creates an event in the user's primary Google Calendar
 */
export async function createGoogleCalendarEvent(token, { title, description, start_time, end_time }) {
    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            summary: title,
            description: description || 'Created from Noteworthy',
            start: {
                dateTime: start_time,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            end: {
                dateTime: end_time,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Calendar API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Creates a task in a specific Google Tasks list (defaults to user's default list)
 */
export async function createGoogleTask(token, { title, notes, due }, listId = '@default') {
    const url = `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks`;
    const body = {
        title: title,
        notes: notes || 'Created from Noteworthy'
    };
    if (due) {
        body.due = due; // RFC 3339 timestamp
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Tasks API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Fetches all of the user's Google Tasks lists
 */
export async function getGoogleTaskLists(token) {
    const url = 'https://www.googleapis.com/tasks/v1/users/@me/lists';
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Tasks Lists API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.items || [];
}

/**
 * Creates a Google Document and writes content to it
 */
export async function createGoogleDoc(token, { title, content }) {
    // Step 1: Create the empty document
    const createUrl = 'https://docs.googleapis.com/v1/documents';
    const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: title })
    });

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Google Docs Creation Error: ${createResponse.status} - ${errorText}`);
    }

    const docData = await createResponse.json();
    const documentId = docData.documentId;
    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    // Step 2: If there's content, insert it into the document
    if (content && content.trim().length > 0) {
        const updateUrl = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
        const updateResponse = await fetch(updateUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [
                    {
                        insertText: {
                            text: content,
                            location: { index: 1 }
                        }
                    }
                ]
            })
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error(`Google Docs content insert failed (Doc ID: ${documentId}):`, errorText);
            // We still return the doc ID because the document was successfully created, even if writing content failed.
        }
    }

    return {
        documentId,
        alternateLink: docUrl,
        title
    };
}
