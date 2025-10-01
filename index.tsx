/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, FormEvent, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

interface BusinessLead {
  name: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  category?: string;
  rating?: number | null;
  reviewCount?: number | null;
  hours?: string;
}

// Fix: Add interface for grounding chunks.
interface GroundingChunk {
    web?: {
      uri: string;
      title: string;
    };
}

const EmptyState: React.FC<{ lastSearch: string }> = ({ lastSearch }) => (
    <div className="empty-state">
      <div className="empty-state-icon">
        {lastSearch ? '🤷' : '🔍'}
      </div>
      <h2>{lastSearch ? 'No Leads Found' : 'Find Local Business Leads'}</h2>
      <p>
        {lastSearch
          ? `Your search for "${lastSearch}" did not return any results. Try adjusting your keywords or expanding your radius.`
          : 'Use the form above to search for businesses by keyword and location.'}
      </p>
    </div>
  );

const App: React.FC = () => {
  const [keyword, setKeyword] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [radius, setRadius] = useState<string>('');
  const [leads, setLeads] = useState<BusinessLead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCreatingGist, setIsCreatingGist] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [mapQuery, setMapQuery] = useState<string>('');
  const [lastSearch, setLastSearch] = useState<string>('');
  const [copiedTooltip, setCopiedTooltip] = useState<{index: number, field: string} | null>(null);
  const [savedSearches, setSavedSearches] = useState<string[]>([]);
  const [canSaveSearch, setCanSaveSearch] = useState<boolean>(false);
  // Fix: Add state for grounding sources.
  const [sources, setSources] = useState<GroundingChunk[]>([]);
  
  useEffect(() => {
    try {
      const storedSearches = localStorage.getItem('savedLeadSearches');
      if (storedSearches) {
        setSavedSearches(JSON.parse(storedSearches));
      }
    } catch (e) {
      console.error("Failed to parse saved searches from localStorage", e);
    }
  }, []);

  useEffect(() => {
    // Debounce the map preview update
    const handler = setTimeout(() => {
      if (location.trim()) {
        setMapQuery(location.trim());
      }
    }, 500); // 500ms delay after user stops typing

    return () => {
      clearTimeout(handler);
    };
  }, [location]);

  const runSearch = async (query: string) => {
    setIsLoading(true);
    setError(null);
    setLeads([]);
    setCopied(false);
    setLastSearch(query);
    setCanSaveSearch(false);
    setSources([]);

    try {
      const prompt = `You are an expert business data extraction API. Your sole purpose is to find local business information and return it in a specific JSON format.
**Query:** "${query}"
**Rules:**
1. The business's physical address **MUST** be located within the geographical area of the specified location. Do not include businesses located elsewhere, even if their name contains the location.
2. You **MUST** return each business object as a single line of JSON (JSONL format).
3. Every object **MUST** contain all of the following keys: "name", "address", "phone", "website", "email", "category", "rating", "reviewCount", "hours".
4. If a specific piece of information for a key is not found or not applicable (e.g., no public email), you **MUST** use the value \`null\` for that key. Do not omit any keys from the object.
5. Do not invent or estimate data. Accuracy is critical. Star ratings must be a number between 1 and 5.
6. Return a maximum of 30 results.
7. Your entire response must be **ONLY** the JSON objects, each on a new line. Do not wrap them in a JSON array.
**Example Format:**
{"name": "Example Bakery", "address": "123 Main St, Anytown, USA 12345", "phone": "555-123-4567", "website": "http://www.examplebakery.com", "email": "contact@examplebakery.com", "category": "Bakery", "rating": 4.5, "reviewCount": 150, "hours": "7:00 AM - 6:00 PM"}
{"name": "Another Business", "address": "456 Oak Ave, Anytown, USA 12345", "phone": null, "website": "http://www.anotherbusiness.com", "email": null, "category": "Retail", "rating": 4.0, "reviewCount": 85, "hours": null}
Now, process the query and return the JSONL.`;

      const response = await fetch('/.netlify/functions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch from server: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response body is missing.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = ''; // Buffer for incoming stream chunks from fetch
      let jsonBuffer = '';   // Buffer for the JSONL content from the stream payload

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        
        let newlineIndex;
        while ((newlineIndex = streamBuffer.indexOf('\n')) !== -1) {
          const line = streamBuffer.substring(0, newlineIndex).trim();
          streamBuffer = streamBuffer.substring(newlineIndex + 1);

          if (line) {
            try {
              const message = JSON.parse(line);

              if (message.type === 'content' && message.payload) {
                jsonBuffer += message.payload;
                
                let leadNewlineIndex;
                while ((leadNewlineIndex = jsonBuffer.indexOf('\n')) !== -1) {
                  const leadLine = jsonBuffer.substring(0, leadNewlineIndex).trim();
                  jsonBuffer = jsonBuffer.substring(leadNewlineIndex + 1);
                  if (leadLine) {
                    try {
                      const parsedLead: BusinessLead = JSON.parse(leadLine);
                      setLeads(prevLeads => [...prevLeads, parsedLead]);
                    } catch (e) {
                      console.warn("Could not parse JSON lead line:", leadLine, e);
                    }
                  }
                }
              } else if (message.type === 'sources' && message.payload) {
                const newChunks = message.payload as GroundingChunk[];
                // Server sends unique sources, so just append them
                setSources(prevSources => [...prevSources, ...newChunks]);
              }
            } catch (e) {
              console.warn("Could not parse stream message:", line, e);
            }
          }
        }
      }

      // Process any remaining data in the jsonBuffer
      if (jsonBuffer.trim()) {
        try {
            const parsedLead: BusinessLead = JSON.parse(jsonBuffer.trim());
            setLeads(prevLeads => [...prevLeads, parsedLead]);
        } catch (e) {
            console.warn("Could not parse final JSON buffer:", jsonBuffer.trim(), e);
        }
      }

    } catch (err) {
      console.error(err);
      let errorMessage = "An unexpected error occurred. Please try again.";
      if (err instanceof Error) {
        if (err.message.includes('JSON')) {
          errorMessage = "Failed to process the response. The format might be invalid.";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      // Check if any leads were found to enable saving
      setLeads(currentLeads => {
        if(currentLeads.length > 0) {
            const isSaved = savedSearches.some(s => s.toLowerCase() === query.toLowerCase());
            if (!isSaved) {
                setCanSaveSearch(true);
            }
        }
        return currentLeads;
      });
    }
  };

  const findLeads = (e: FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || !location.trim()) return;

    let fullQuery = `"${keyword}" in "${location}"`;
    if (radius.trim()) {
        fullQuery += ` within a ${radius} km radius`;
    }
    setMapQuery(fullQuery);
    runSearch(fullQuery);
  };

  const handleSavedSearchClick = (query: string) => {
    const parts = query.match(/"(.*?)" in "(.*?)"(?: within a (\d+) km radius)?/);
    if(parts) {
        setKeyword(parts[1] || '');
        setLocation(parts[2] || '');
        setRadius(parts[3] || '');
        setMapQuery(query);
    }
    runSearch(query);
  }

  const saveSearch = () => {
    if (!lastSearch || !canSaveSearch) return;
    const updatedSearches = [lastSearch, ...savedSearches.filter(s => s.toLowerCase() !== lastSearch.toLowerCase())];
    setSavedSearches(updatedSearches);
    localStorage.setItem('savedLeadSearches', JSON.stringify(updatedSearches));
    setCanSaveSearch(false);
  }

  const copyEmails = () => {
    const emails = leads
      .map(lead => lead.email)
      .filter(email => email)
      .join(', ');

    if (emails) {
      navigator.clipboard.writeText(emails).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const generateCSVContent = (): string => {
    if (leads.length === 0) return '';
    const headers = 'Name,Category,Rating,Review_Count,Address,Phone,Website,Email,Hours\n';
    const csvRows = leads.map(lead => {
        const row = [
            lead.name,
            lead.category,
            lead.rating,
            lead.reviewCount,
            lead.address,
            lead.phone,
            lead.website,
            lead.email,
            lead.hours,
        ];
        return row.map(val => {
            const str = String(val === null || val === undefined ? '' : val);
            return `"${str.replace(/"/g, '""')}"`;
        }).join(',');
    }).join('\n');
    return headers + csvRows;
  };

  const exportCSV = () => {
    const csvContent = generateCSVContent();
    if (!csvContent) return;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.href) {
        URL.revokeObjectURL(link.href);
    }
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', `${keyword}_${location}_leads.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveToGist = async () => {
    if (leads.length === 0) return;
    setIsCreatingGist(true);
    setError(null);

    try {
        const csvContent = generateCSVContent();
        const description = `Business leads for: ${lastSearch}`;
        const fileName = `${keyword.replace(/ /g, '_')}_${location.replace(/ /g, '_')}_leads.csv`;

        const response = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
            },
            body: JSON.stringify({
                description: description,
                public: true,
                files: {
                    [fileName]: {
                        content: csvContent,
                    },
                },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`GitHub API Error: ${errorData.message || response.statusText}`);
        }

        const gistData = await response.json();
        if (gistData.html_url) {
            window.open(gistData.html_url, '_blank');
        } else {
            throw new Error("Could not get Gist URL from GitHub API response.");
        }

    } catch (err) {
        console.error("Failed to create Gist:", err);
        let errorMessage = "Failed to save to GitHub Gist. Please try again.";
        if (err instanceof Error) {
            errorMessage = err.message;
        }
        setError(errorMessage);
    } finally {
        setIsCreatingGist(false);
    }
  };

  const handleCopy = (text: string, index: number, field: string) => {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTooltip({index, field});
      setTimeout(() => setCopiedTooltip(null), 1500);
    });
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Local Lead Finder</h1>
        <p>Instantly find business leads from Google Maps.</p>
      </header>
      
      <form className="search-form" onSubmit={findLeads}>
        <input
          type="text"
          className="search-input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Enter Keyword"
          aria-label="Keyword"
          disabled={isLoading}
        />
        <input
        type="text"
        className="search-input"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Enter Location"
        aria-label="Location"
        disabled={isLoading}
        />
        <input
          type="number"
          min="1"
          className="search-input"
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
          placeholder="Radius (km) - Optional"
          aria-label="Radius (in km) - Optional"
          disabled={isLoading}
        />
        <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={isLoading || !keyword.trim() || !location.trim()}>
            {isLoading ? <span className="pulsing-text">Searching...</span> : 'Find Leads'}
            </button>
            {canSaveSearch && !isLoading && (
                 <button type="button" onClick={saveSearch} className="btn btn-save" title="Save this search">
                    💾
                 </button>
            )}
        </div>
      </form>

        {savedSearches.length > 0 && (
            <div className="saved-searches-container">
                {savedSearches.slice(0, 10).map((search, index) => (
                    <button key={index} onClick={() => handleSavedSearchClick(search)} className="saved-search-tag">
                        {search}
                    </button>
                ))}
            </div>
        )}

      {isLoading && leads.length === 0 && (
        <div className="loader-container" aria-label="Loading results">
          <div className="loader"></div>
          <p className="loading-message">Searching for leads...</p>
        </div>
      )}

      {error && <div className="error-message" role="alert">{error}</div>}
      
      {(leads.length > 0 || isLoading || mapQuery) && (
        <div className="content-wrapper">
            <section className="results-section">
                { (leads.length > 0 || isLoading) && 
                    <>
                        <div className="results-header">
                            <h2>Found {leads.length} Leads {isLoading && <span className="loader-inline"></span>}</h2>
                            <div className="results-actions">
                                <button onClick={copyEmails} className="btn btn-secondary" disabled={!leads.some(l => l.email)}>
                                    {copied ? 'Copied!' : 'Copy Emails'}
                                </button>
                                <button onClick={exportCSV} className="btn btn-secondary" disabled={leads.length === 0}>
                                    Export CSV
                                </button>
                                <button onClick={saveToGist} className="btn btn-secondary" disabled={leads.length === 0 || isCreatingGist}>
                                    {isCreatingGist ? (
                                        'Saving...'
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.19.01-.82.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21-.15.46-.55.38A8.013 8.013 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>
                                            Save to Gist
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                        {sources.length > 0 && (
                            <div className="sources-container">
                                <p><strong>Sources from Google Search:</strong></p>
                                <ul>
                                    {sources.map((chunk, index) => chunk.web && (
                                        <li key={index}>
                                            <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer">
                                                {chunk.web.title || chunk.web.uri}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <div className="results-grid">
                        {leads.map((lead, index) => (
                            <article key={index} className="lead-card">
                                <div className="lead-card-header">
                                    <h3>{lead.name}</h3>
                                    {lead.category && <span className="lead-card-category">{lead.category}</span>}
                                </div>
                                { (lead.rating || lead.reviewCount) &&
                                    <div className="lead-card-rating">
                                        {lead.rating && <span>⭐ {lead.rating.toFixed(1)}</span>}
                                        {lead.reviewCount && <span className="review-count">({lead.reviewCount} reviews)</span>}
                                    </div>
                                }
                                <hr className="card-divider" />
                                <div className="lead-card-details">
                                    {lead.address && <div className="detail-item"><span>📍</span><span className="copyable" onClick={() => handleCopy(lead.address, index, 'address')}>{lead.address} {copiedTooltip?.index === index && copiedTooltip?.field === 'address' && <span className="tooltip">Copied!</span>}</span></div>}
                                    {lead.phone && <div className="detail-item"><span>📞</span><span className="copyable" onClick={() => handleCopy(lead.phone, index, 'phone')}><a href={`tel:${lead.phone}`}>{lead.phone}</a> {copiedTooltip?.index === index && copiedTooltip?.field === 'phone' && <span className="tooltip">Copied!</span>}</span></div>}
                                    {lead.email && <div className="detail-item"><span>✉️</span><span className="copyable" onClick={() => handleCopy(lead.email, index, 'email')}><a href={`mailto:${lead.email}`}>{lead.email}</a> {copiedTooltip?.index === index && copiedTooltip?.field === 'email' && <span className="tooltip">Copied!</span>}</span></div>}
                                    {lead.website && <div className="detail-item"><span>🌐</span><a href={lead.website && lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer">{lead.website}</a></div>}
                                    {lead.hours && <div className="detail-item"><span>🕒</span><span>{lead.hours}</span></div>}
                                </div>
                            </article>
                        ))}
                        </div>
                    </>
                }
            </section>
            {mapQuery && (
                <aside className="map-section">
                    <iframe
                        key={mapQuery}
                        title={`Map of ${mapQuery}`}
                        width="100%"
                        height="100%"
                        loading="lazy"
                        allowFullScreen
                        src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                    ></iframe>
                </aside>
            )}
        </div>
      )}

      {!isLoading && !error && leads.length === 0 && !mapQuery && (
          <EmptyState lastSearch={lastSearch} />
      )}
      <footer className="footer">
        Copyright © 2025 indovma
      </footer>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);