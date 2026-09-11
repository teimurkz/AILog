import { useState } from 'react';
import { useFirestoreCollection } from './useFirestoreCollection';
import { contactsApi } from '../services/api';
import { dataLoadError } from '../services/collection-state';
import type { SavedDeliveryContact } from '../types';

export const useSavedDeliveryContacts = () => {
  const { data, ...state } = useFirestoreCollection<SavedDeliveryContact>('saved_delivery_contacts');
  const [writeError, setWriteError] = useState<string | null>(null);
  const savedContacts = data.map(contact => ({ ...contact, title: contact.title || `${contact.city || 'Город'} — ${contact.deliveryAddress || 'Адрес'}`, city: contact.city || '', deliveryAddress: contact.deliveryAddress || '', recipientPhone: contact.recipientPhone || '', recipientName: contact.recipientName || '' }));
  const addSavedContact = async (contact: Omit<SavedDeliveryContact, 'id' | 'createdAt'>) => {
    const existing = savedContacts.find(item => item.deliveryAddress.trim().toLowerCase() === contact.deliveryAddress.trim().toLowerCase() && item.city.trim().toLowerCase() === contact.city.trim().toLowerCase());
    if (existing) return existing.id;
    setWriteError(null);
    try {
      const saved = await contactsApi.saveContact({ ...contact, title: contact.title.trim() || `${contact.city} — ${contact.deliveryAddress}`, createdAt: new Date().toISOString() });
      return saved.id;
    } catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  const deleteSavedContact = async (id: string) => {
    setWriteError(null);
    try { await contactsApi.deleteContact(id); }
    catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  return { savedContacts, ...state, error: writeError || state.error, retry: () => { setWriteError(null); state.retry(); }, addSavedContact, deleteSavedContact };
};
