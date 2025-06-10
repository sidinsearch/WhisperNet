import React from 'react';
import { formatVerificationTime } from '../utils/keyVerification';

const VerificationModal = ({ 
  isOpen, 
  onClose, 
  verificationInfo, 
  onVerify, 
  onCancel,
  username
}) => {
  if (!isOpen) return null;

  const { 
    status, 
    message, 
    contactUsername, 
    fingerprint, 
    previousFingerprint,
    verifiedAt
  } = verificationInfo;

  // Determine modal type based on status
  const isWarning = status === 'key_mismatch' || status === 'device_changed';
  const isNewContact = status === 'new_contact';

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#171c28',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        width: '90%',
        maxWidth: 500,
        padding: 24,
        border: isWarning ? '1px solid #ff3333' : '1px solid #1e2d3d'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16
        }}>
          <h2 style={{
            color: isWarning ? '#ff3333' : (isNewContact ? '#5ccfe6' : '#bae67e'),
            margin: 0,
            fontSize: 18
          }}>
            {isWarning ? '⚠️ Identity Verification Warning' : 
              (isNewContact ? 'New Contact Verification' : 'Identity Verified')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#636b78',
              fontSize: 20,
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{
          backgroundColor: '#0d1117',
          padding: 16,
          borderRadius: 4,
          marginBottom: 20,
          border: '1px solid #1e2d3d'
        }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#636b78', fontSize: 12, marginBottom: 4 }}>
              CONTACT
            </div>
            <div style={{ color: '#a2aabc', fontSize: 16, fontWeight: 'bold' }}>
              {contactUsername}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#636b78', fontSize: 12, marginBottom: 4 }}>
              CURRENT KEY FINGERPRINT
            </div>
            <div style={{ 
              color: '#5ccfe6', 
              fontFamily: '"Fira Code", monospace',
              fontSize: 14,
              padding: '4px 8px',
              background: 'rgba(92, 207, 230, 0.1)',
              borderRadius: 4,
              display: 'inline-block'
            }}>
              {fingerprint}
            </div>
          </div>

          {previousFingerprint && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#636b78', fontSize: 12, marginBottom: 4 }}>
                PREVIOUS KEY FINGERPRINT
              </div>
              <div style={{ 
                color: '#ff8f40', 
                fontFamily: '"Fira Code", monospace',
                fontSize: 14,
                padding: '4px 8px',
                background: 'rgba(255, 143, 64, 0.1)',
                borderRadius: 4,
                display: 'inline-block',
                textDecoration: 'line-through'
              }}>
                {previousFingerprint}
              </div>
            </div>
          )}

          {verifiedAt && (
            <div>
              <div style={{ color: '#636b78', fontSize: 12, marginBottom: 4 }}>
                LAST VERIFIED
              </div>
              <div style={{ color: '#a2aabc', fontSize: 14 }}>
                {formatVerificationTime(verifiedAt)}
              </div>
            </div>
          )}
        </div>

        {/* Message */}
        <div style={{
          padding: 16,
          backgroundColor: isWarning ? 'rgba(255, 51, 51, 0.1)' : 'rgba(186, 230, 126, 0.1)',
          borderRadius: 4,
          marginBottom: 20,
          borderLeft: isWarning ? '3px solid #ff3333' : '3px solid #bae67e'
        }}>
          <p style={{ 
            color: isWarning ? '#ff8f40' : '#bae67e', 
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5
          }}>
            {isWarning ? (
              <>
                <strong>Warning:</strong> {message}
                <br /><br />
                This could happen if:
                <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                  <li>The contact logged in from a new device</li>
                  <li>The contact cleared their browser data</li>
                  <li>Someone is attempting to impersonate this contact</li>
                </ul>
              </>
            ) : isNewContact ? (
              <>
                You haven't previously verified the identity of this user. 
                <br /><br />
                Verifying now will allow you to detect if their identity changes in the future.
              </>
            ) : (
              message
            )}
          </p>
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12
        }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid #1e2d3d',
              color: '#636b78',
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 14,
              cursor: 'pointer'
            }}
          >
            {isWarning ? 'Cancel' : 'Close'}
          </button>
          
          {(isWarning || isNewContact) && (
            <button
              onClick={onVerify}
              style={{
                background: isWarning ? '#ff3333' : '#5ccfe6',
                color: '#171c28',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {isWarning ? 'Trust Anyway' : 'Verify Identity'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerificationModal;