import React, { createContext, useState, useEffect, useContext } from 'react';
import { api } from '../services/api';

export const RecordsContext = createContext();

export const RecordsProvider = ({ children }) => {
const [records, setRecords] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
const fetchInitialData = async () => {
try {
const data = await api.getRecords();
setRecords(Array.isArray(data) ? data : []);
} catch (error) {
console.error("Erro ao buscar no Postgres:", error);
} finally {
setLoading(false);
}
};
fetchInitialData();
}, []);

const addRecord = async (newRecord) => {
try {
const savedRecord = await api.createRecord(newRecord);
setRecords(prev => [...prev, savedRecord]);
} catch (error) {
console.error("Erro ao salvar no banco:", error);
}
};

const updateRecord = async (id, updatedData) => {
try {
const updated = await api.updateRecord(id, updatedData);
setRecords(prev => prev.map(r => (r.id === id ? updated : r)));
} catch (error) {
console.error("Erro ao atualizar no banco:", error);
}
};

const deleteRecord = async (id) => {
try {
await api.deleteRecord(id);
setRecords(prev => prev.filter(r => r.id !== id));
} catch (error) {
console.error("Erro ao deletar do banco:", error);
}
};

return (
<RecordsContext.Provider value={{ records, loading, addRecord, updateRecord, deleteRecord }}>
{children}
</RecordsContext.Provider>
);
};

export const useRecords = () => useContext(RecordsContext);