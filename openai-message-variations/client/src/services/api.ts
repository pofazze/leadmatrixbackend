import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export const fetchMessageVariations = async (prompt: string): Promise<any> => {
    try {
        const response = await axios.post(`${API_URL}/variations`, { prompt });
        return response.data;
    } catch (error) {
        console.error('Error fetching message variations:', error);
        throw error;
    }
};