import { useState, useEffect } from 'react';
import { contactsApi, subscribeToRealtimeStream } from '../services/api';
import { SavedDeliveryContact } from '../types';

const STORAGE_KEY = 'regional_saved_delivery_contacts_v2';

export const useSavedDeliveryContacts = () => {
  const [savedContacts, setSavedContacts] = useState<SavedDeliveryContact[]>(() => {
    try {
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("Failed to read saved contacts from localStorage:", e);
    }
    return [];
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadContacts = async () => {
      try {
        const list = await contactsApi.getContacts();
        if (!isCancelled && Array.isArray(list)) {
          setSavedContacts(list);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
          setLoading(false);
        }
      } catch (err) {
        console.warn("Failed to load contacts from local API, using local storage:", err);
        if (!isCancelled) setLoading(false);
      }
    };

    loadContacts();

    const unsubscribe = subscribeToRealtimeStream((eventType, data) => {
      if (isCancelled) return;
      if (eventType === 'contact_updated' && data?.id) {
        setSavedContacts(prev => {
          const exists = prev.some(c => c.id === data.id);
          const updated = exists ? prev.map(c => (c.id === data.id ? { ...c, ...data } : c)) : [data, ...prev];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      } else if (eventType === 'contact_deleted' && data?.id) {
        setSavedContacts(prev => {
          const updated = prev.filter(c => c.id !== data.id);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  const addSavedContact = async (contact: Omit<SavedDeliveryContact, 'id' | 'createdAt'>) => {
    const title = contact.title.trim() || `${contact.city} — ${contact.deliveryAddress.slice(0, 30)} (${contact.recipientPhone})`;

    const existing = savedContacts.find(
      c => c.deliveryAddress.trim().toLowerCase() === contact.deliveryAddress.trim().toLowerCase() &&
           c.city.trim().toLowerCase() === contact.city.trim().toLowerCase()
    );
    if (existing) {
      return existing.id;
    }

    const newContact: SavedDeliveryContact = {
      id: `CNT-${Date.now().toString().slice(-5)}`,
      title,
      city: contact.city.trim(),
      deliveryAddress: contact.deliveryAddress.trim(),
      recipientPhone: contact.recipientPhone.trim(),
      recipientName: contact.recipientName.trim(),
      createdAt: new Date().toISOString(),
    };

    const updated = [newContact, ...savedContacts];
    setSavedContacts(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    contactsApi.saveContact(newContact).catch(err => {
      console.warn("Could not sync contact to backend:", err);
    });

    return newContact.id;
  };

  const deleteSavedContact = async (id: string) => {
    const updated = savedContacts.filter(c => c.id !== id);
    setSavedContacts(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    contactsApi.deleteContact(id).catch(err => {
      console.warn("Could not delete contact from backend:", err);
    });
  };

  return {
    savedContacts,
    loading,
    addSavedContact,
    deleteSavedContact,
  };
};
