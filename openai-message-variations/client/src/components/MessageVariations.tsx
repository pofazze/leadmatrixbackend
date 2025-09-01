import React, { useEffect, useState } from 'react';
import { fetchMessageVariations } from '../services/api';

export default function MessageVariations() {
    const [variations, setVariations] = useState<string[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [inputMessage, setInputMessage] = useState<string>('');

    const handleFetchVariations = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetchMessageVariations(inputMessage);
            setVariations(response);
        } catch (err) {
            setError('Failed to fetch message variations. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="message-variations">
            <h2 className="text-base uppercase tracking-wide text-gray-400 mb-3">Message Variations</h2>
            <div className="flex flex-col mb-3">
                <textarea
                    className="border border-gray-800 rounded p-2"
                    rows={4}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Enter your message here..."
                />
                <button
                    className="btn bg-gray-800 hover:bg-gray-700 mt-2"
                    onClick={handleFetchVariations}
                    disabled={loading || !inputMessage}
                >
                    {loading ? 'Loading...' : 'Get Variations'}
                </button>
            </div>
            {error && <div className="bg-red-950/40 border border-red-900 text-red-200 p-3 rounded mb-3">{error}</div>}
            <div className="variations-list">
                {variations.length > 0 && (
                    <ul className="list-disc pl-5">
                        {variations.map((variation, index) => (
                            <li key={index} className="text-gray-300">{variation}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}