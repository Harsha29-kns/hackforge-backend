const paymentVerificationTemplate = (studentName, teamName) => `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
    </style>
  </head>
  <body style="font-family: 'Roboto', Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
      <div style="background: linear-gradient(90deg, #4a00e0, #8e2de2); color: #ffffff; padding: 30px 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 28px;">Registration Pending</h1>
      </div>
      <div style="padding: 30px 25px; color: #333333; line-height: 1.6;">
        <p style="font-size: 16px;">Hello <strong style="color: #4a00e0;">${studentName}</strong>,</p>
        <p style="font-size: 16px;">
          Thank you for submitting your registration. We've received the entry for your team,
          <strong style="color: #4a00e0;">${teamName}</strong>, and it's now in the queue for verification.
        </p>
        <div style="background-color: #f9f6ff; border-left: 4px solid #8e2de2; padding: 15px; margin: 20px 0; font-size: 15px;">
          <strong>Status:</strong> Payment Verification In Progress
          <p style="margin: 5px 0 0 0;">No further action is required from you at this moment. We'll notify you as soon as the process is complete.</p>
        </div>
        <p style="font-size: 16px;">You will receive another email from us once your payment is confirmed.</p>
        <p style="font-size: 16px; margin-top: 30px;">Best regards,<br>
          <strong style="color: #4a00e0;">The Scorecraft Team</strong>
        </p>
      </div>
      <div style="background-color: #f1f1f1; color: #888888; text-align: center; padding: 15px; font-size: 12px;">
        <p style="margin: 0;">&copy; 2025 Scorecraft. All Rights Reserved.</p>
      </div>
    </div>
  </body>
  </html>
`;

const qrCodeEmailTemplate = (studentName, teamName, members) => {
    const memberHtml = members.map((member, index) => `
      <div style="background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin-bottom: 15px; text-align: left; display: flex; align-items: center; gap: 20px;">
        <img src="cid:qrcode${index}" alt="QR Code" style="width: 100px; height: 100px; border-radius: 4px;"/>
        <div>
          <h3 style="margin: 0 0 5px 0; color: #4a00e0; font-size: 18px;">
            ${member.name} ${member.isLead ? '<span style="background-color: #4a00e0; color: white; font-size: 10px; padding: 3px 8px; border-radius: 10px; vertical-align: middle; margin-left: 8px;">LEAD</span>' : ''}
          </h3>
          <p style="margin: 0; color: #555555; font-size: 14px;">Reg No: ${member.regNo}</p>
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
        </style>
      </head>
      <body style="font-family: 'Roboto', Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(90deg, #4a00e0, #8e2de2); color: #ffffff; padding: 30px 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">Your Event Credentials</h1>
          </div>
          <div style="padding: 30px 25px; color: #333333; line-height: 1.6;">
            <p style="font-size: 16px;">Hello <strong style="color: #4a00e0;">${studentName}</strong>,</p>
            <p style="font-size: 16px;">
              Get ready! Here are the official event credentials for your team,
              <strong style="color: #4a00e0;">${teamName}</strong>.
            </p>
            <p style="font-size: 16px;">
              Please distribute the unique QR code to each team member. <strong>These are required for check-in and attendance</strong> at all rounds.
            </p>
            <p style="font-size: 16px; margin-top: 30px;">
              To receive all important updates, announcements, and schedules, please join our official WhatsApp group.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://chat.whatsapp.com/Is73YCPbEeN9vbhyGAoFLe" style="text-decoration: none; background: linear-gradient(90deg, #4a00e0, #8e2de2); color: #ffffff; padding: 15px 35px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
                Join Official Group
              </a>
            </div>

            <div style="margin-top: 30px; background-color: #f9f6ff; padding: 20px; border-radius: 8px;">
              ${memberHtml}
            </div>
            
            <p style="font-size: 16px; margin-top: 30px;">Best of luck,<br>
              <strong style="color: #4a00e0;">The Scorecraft Team</strong>
            </p>
          </div>
          <div style="background-color: #f1f1f1; color: #888888; text-align: center; padding: 15px; font-size: 12px;">
            <p style="margin: 0;">&copy; 2025 Scorecraft. All Rights Reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
};

module.exports = {
    paymentVerificationTemplate,
    qrCodeEmailTemplate,
};