import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Ticket, TicketComment, TicketActivity, TicketFilters, PaginatedResponse, JiraConfig } from '../../shared/types';

/**
 * Hook to retrieve a paginated list of tickets
 */
export function useTickets(filters: TicketFilters) {
  const { getJWT } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getJWT();
      const queryParams = new URLSearchParams();
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.priority) queryParams.append('priority', filters.priority);
      if (filters.type) queryParams.append('type', filters.type);
      if (filters.assignee) queryParams.append('assignee', filters.assignee);
      if (filters.search) queryParams.append('search', filters.search);
      if (filters.page) queryParams.append('page', String(filters.page));
      if (filters.limit) queryParams.append('limit', String(filters.limit));
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder);
      if (filters.overdue) queryParams.append('overdue', 'true');

      const response = await fetch(`/api/tickets?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to fetch tickets');
      }

      const resData: PaginatedResponse<Ticket> = await response.json();
      setTickets(resData.data);
      setTotal(resData.total);
      setPage(resData.page);
      setTotalPages(resData.totalPages);
    } catch (err: any) {
      console.error('Error fetching tickets:', err);
      setError(err.message || 'An error occurred while fetching tickets.');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.priority, filters.type, filters.assignee, filters.search, filters.page, filters.limit, filters.sortBy, filters.sortOrder, getJWT]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  return { tickets, total, page, totalPages, loading, error, refetch: fetchTickets };
}

/**
 * Hook to retrieve a single ticket, its comments, and activity log in parallel
 */
export function useTicket(id: string) {
  const { getJWT } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [activity, setActivity] = useState<TicketActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTicketDetails = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getJWT();
      const headers = { 'Authorization': `Bearer ${token}` };

      const [ticketRes, commentsRes, activityRes] = await Promise.all([
        fetch(`/api/tickets/${id}`, { headers }),
        fetch(`/api/tickets/${id}/comments`, { headers }),
        fetch(`/api/tickets/${id}/activity`, { headers })
      ]);

      if (!ticketRes.ok) {
        throw new Error(`Failed to fetch ticket: ${ticketRes.statusText}`);
      }

      const ticketData = await ticketRes.json();
      const commentsData = commentsRes.ok ? await commentsRes.json() : [];
      const activityData = activityRes.ok ? await activityRes.json() : [];

      setTicket(ticketData);
      // Guard against a non-array success body (e.g. an error envelope) so the
      // later .map() in the view can't throw during render.
      setComments(Array.isArray(commentsData) ? commentsData : []);
      setActivity(Array.isArray(activityData) ? activityData : []);
    } catch (err: any) {
      console.error('Error fetching ticket details:', err);
      setError(err.message || 'Failed to load ticket details.');
    } finally {
      setLoading(false);
    }
  }, [id, getJWT]);

  useEffect(() => {
    fetchTicketDetails();
  }, [fetchTicketDetails]);

  return { ticket, comments, activity, loading, error, refetch: fetchTicketDetails };
}

/**
 * Hook to retrieve ticket statistics
 */
export function useStats() {
  const { getJWT } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getJWT();
      const response = await fetch('/api/tickets/stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch ticket stats');
      }

      const data = await response.json();
      setStats(data);
    } catch (err: any) {
      console.error('Error fetching ticket stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getJWT]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

// Helper fetch calls (Not Hooks)

export async function findTicketByFinding(getJWT: () => Promise<string | null>, findingId: string): Promise<Ticket | null> {
  try {
    const token = await getJWT();
    const response = await fetch(`/api/tickets/by-finding/${findingId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(await response.text() || 'Failed to find ticket by finding');
    }

    return response.json();
  } catch (err) {
    console.error('Error finding ticket by finding:', err);
    return null;
  }
}

export async function createTicketFromFinding(
  getJWT: () => Promise<string | null>,
  findingData: { findingId: string; title: string; description: string; severity: number; type?: string }
): Promise<Ticket> {
  const token = await getJWT();
  const response = await fetch('/api/tickets/from-finding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(findingData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to create ticket from finding');
  }

  return response.json();
}

export async function createTicket(getJWT: () => Promise<string | null>, ticketData: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>): Promise<Ticket> {
  const token = await getJWT();
  const response = await fetch('/api/tickets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(ticketData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to create ticket');
  }

  return response.json();
}

export async function updateTicket(getJWT: () => Promise<string | null>, id: string, updates: Partial<Ticket>): Promise<Ticket> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(updates)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to update ticket');
  }

  return response.json();
}

export async function deleteTicket(getJWT: () => Promise<string | null>, id: string): Promise<void> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to delete ticket');
  }
}

export async function addComment(getJWT: () => Promise<string | null>, ticketId: string, body: string): Promise<TicketComment> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ body })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to add comment');
  }

  return response.json();
}

export async function addTicketLink(getJWT: () => Promise<string | null>, ticketId: string, targetId: string, type: string): Promise<Ticket> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${ticketId}/links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ targetId, type })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to add ticket link');
  }

  return response.json();
}

export async function removeTicketLink(getJWT: () => Promise<string | null>, ticketId: string, targetId: string): Promise<Ticket> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${ticketId}/links/${targetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to remove ticket link');
  }

  return response.json();
}

export async function syncToJira(getJWT: () => Promise<string | null>, id: string): Promise<any> {
  const token = await getJWT();
  const response = await fetch(`/api/tickets/${id}/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.json();
    throw new Error(errorText.error || 'Failed to sync with Jira');
  }

  return response.json();
}

export async function bulkSyncToJira(getJWT: () => Promise<string | null>): Promise<{ total: number; synced: number; failed: number; results: any[] }> {
  const token = await getJWT();
  const response = await fetch('/api/tickets/sync/bulk', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to perform bulk sync');
  }

  return response.json();
}

export async function saveJiraConfig(getJWT: () => Promise<string | null>, config: JiraConfig): Promise<any> {
  const token = await getJWT();
  const response = await fetch('/api/tickets/jira/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to save Jira configuration');
  }

  return response.json();
}

export async function testJiraConnection(getJWT: () => Promise<string | null>): Promise<any> {
  const token = await getJWT();
  const response = await fetch('/api/tickets/jira/test', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.json();
    throw new Error(errorText.error || 'Failed to test Jira connection');
  }

  return response.json();
}
