import { useState } from 'react';

export default function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Contact form submitted:', formData);
    alert('Message sent! (Demo - not actually sent)');
    setFormData({ name: '', email: '', message: '' });
  };

  return (
    <section id="contact" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      padding: '80px 48px',
    }}>
      <div style={{
        maxWidth: '600px',
        margin: '0 auto',
        width: '100%',
      }}>
        <h2 style={{
          fontSize: '48px',
          fontWeight: '700',
          marginBottom: '16px',
          textAlign: 'center',
        }}>
          Get in Contact
        </h2>
        <p style={{
          fontSize: '16px',
          color: 'hsl(var(--muted-foreground))',
          textAlign: 'center',
          marginBottom: '48px',
        }}>
          Have questions? Reach out to our team.
        </p>

        <form onSubmit={handleSubmit} style={{
          background: 'hsl(var(--card))',
          backdropFilter: 'blur(10px)',
          borderRadius: '16px',
          padding: '40px',
        }}>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
              Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '8px',
                background: 'hsl(var(--input))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                fontSize: '15px',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '8px',
                background: 'hsl(var(--input))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                fontSize: '15px',
              }}
            />
          </div>

          <div style={{ marginBottom: '32px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
              Message
            </label>
            <textarea
              name="message"
              value={formData.message}
              onChange={handleChange}
              required
              rows={5}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '8px',
                background: 'hsl(var(--input))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                fontSize: '15px',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ textAlign: 'center' }}>
            <button
              type="submit"
              style={{
                padding: '16px 40px',
                borderRadius: '999px',
                fontSize: '16px',
                fontWeight: '600',
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              Send Message
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
