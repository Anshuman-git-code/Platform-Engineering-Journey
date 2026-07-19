import React from 'react';

function InfoPopup({ onClose }) {
  return (
    <div className="info-overlay" onClick={onClose}>
      <div className="info-box" onClick={e => e.stopPropagation()}>
        <h3>About This App</h3>
        <p>This project is built by <strong>Anshuman Mohapatra</strong>, a Cloud & DevOps Engineer. It demonstrates a 3-tier stack with a React frontend, Node.js backend, and MySQL database — containerised with Docker and orchestrated via Kubernetes.</p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default InfoPopup;
