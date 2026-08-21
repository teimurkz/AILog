import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
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
    const path = 'saved_delivery_contacts';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: SavedDeliveryContact[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || `${data.city || 'Город'} — ${data.deliveryAddress || 'Адрес'}`,
          city: data.city || 'Астана',
          deliveryAddress: data.deliveryAddress || '',
          recipientPhone: data.recipientPhone || '',
          recipientName: data.recipientName || '',
          createdAt: data.createdAt || new Date().toISOString(),
        };
      });

      setSavedContacts(fetched);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fetched));
      } catch (e) {
        console.warn("Error updating localStorage saved contacts:", e);
      }
      setLoading(false);
    }, (error) => {
      console.warn("Firestore listener for saved contacts encountered error, using local state:", error);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const addSavedContact = async (contact: Omit<SavedDeliveryContact, 'id' | 'createdAt'>) => {
    const path = 'saved_delivery_contacts';
    const title = contact.title.trim() || `${contact.city} — ${contact.deliveryAddress.slice(0, 30)} (${contact.recipientPhone})`;
    
    // Check if already exists in list to avoid duplicates
    const existing = savedContacts.find(
      c => c.deliveryAddress.trim() === contact.deliveryAddress.trim() && 
           c.recipientPhone.trim() === contact.recipientPhone.trim()
    );
    if (existing) {
      return existing.id;
    }

    const newContact: SavedDeliveryContact = {
      id: `local-${Date.now()}`,
      title,
      city: contact.city.trim(),
      deliveryAddress: contact.deliveryAddress.trim(),
      recipientPhone: contact.recipientPhone.trim(),
      recipientName: contact.recipientName?.trim() || '',
      createdAt: new Date().toISOString(),
    };

    // Update local state immediately
    const updated = [newContact, ...savedContacts];
    setSavedContacts(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Error setting localStorage:", e);
    }

    try {
      const docRef = await addDoc(collection(db, path), {
        title,
        city: contact.city.trim(),
        deliveryAddress: contact.deliveryAddress.trim(),
        recipientPhone: contact.recipientPhone.trim(),
        recipientName: contact.recipientName?.trim() || '',
        createdAt: new Date().toISOString(),
      });
      return docRef.id;
    } catch (error) {
      console.warn("Failed to write saved contact to Firestore (saved locally):", error);
      return newContact.id;
    }
  };

  const deleteSavedContact = async (id: string) => {
    const path = 'saved_delivery_contacts';
    const updated = savedContacts.filter(c => c.id !== id);
    setSavedContacts(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Error updating localStorage after delete:", e);
    }

    if (!id.startsWith('preset-') && !id.startsWith('local-')) {
      try {
        await deleteDoc(doc(db, path, id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  };

  return {
    savedContacts,
    loading,
    addSavedContact,
    deleteSavedContact,
  };
};
