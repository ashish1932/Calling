class ReferralEngine {
  constructor() {
    this.apiBase = '/api/v2/referrals';
  }

  async createReferral(patientId, targetRole, urgency, notes) {
    const token = window.localStorage.getItem('counseling_token');
    if (!token) return null;
    
    try {
      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ patientId, targetRole, urgency, notes })
      });
      return await response.json();
    } catch (e) {
      console.error("Failed to create referral:", e);
      return null;
    }
  }

  async getMyReferrals() {
    const token = window.localStorage.getItem('counseling_token');
    if (!token) return [];

    try {
      const response = await fetch(this.apiBase, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return await response.json();
    } catch (e) {
      console.error("Failed to fetch referrals:", e);
      return [];
    }
  }

  async updateReferralStatus(referralId, status) {
    const token = window.localStorage.getItem('counseling_token');
    if (!token) return null;

    try {
      const response = await fetch(`${this.apiBase}/${referralId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      return await response.json();
    } catch (e) {
      console.error("Failed to update referral status:", e);
      return null;
    }
  }
}

window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.referrals = new ReferralEngine();
