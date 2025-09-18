const PDFDocument = require('pdfkit');
const path = require('path');

// --- Main function to generate the PDF ---
async function generateTeamPDF(team) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            const primaryColor = '#F97316'; // Orange
            const textColor = '#1F2937';    // Dark Gray
            const lightTextColor = '#6B7280'; // Medium Gray
            const cardBackgroundColor = '#FFFFFF';
            const pageBackgroundColor = '#F3F4F6'; // Lightest Gray

            // --- Page Background ---
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(pageBackgroundColor);
            
            


            // --- Header ---
            const headerY = 40;
            doc.image(path.join(__dirname, '../public/hackforge.png'), 50, headerY, { width: 120 });
            doc.image(path.join(__dirname, '../public/scorecraft.jpg'), doc.page.width - 120, headerY, { width: 70 });
            doc.fontSize(24).font('Helvetica-Bold').fillColor(textColor).text('Team Credentials', 0, headerY + 20, { align: 'center' });
            doc.fontSize(12).font('Helvetica').fillColor(lightTextColor).text('HackForge 2025 Event', 0, headerY + 50, { align: 'center' });


            // --- Team Info Section ---
            const teamInfoY = headerY + 100;
            doc.roundedRect(50, teamInfoY, doc.page.width - 100, 80, 8).fill(cardBackgroundColor);
            doc.fontSize(14).font('Helvetica-Bold').fillColor(textColor).text(team.teamname, 70, teamInfoY + 15);
            
            doc.fontSize(10).font('Helvetica').fillColor(lightTextColor)
               .text('Sector:', 70, teamInfoY + 40, { continued: true })
               .font('Helvetica-Bold').fillColor(textColor).text(` ${team.Sector}`);

            doc.fontSize(10).font('Helvetica').fillColor(lightTextColor)
                .text('Access Code:', 250, teamInfoY + 40, { continued: true })
                .font('Helvetica-Bold').fillColor(textColor).text(` ${team.password}`);
            
            const dividerY = teamInfoY + 80 + 15;
            doc.strokeColor(primaryColor).lineWidth(2).moveTo(50, dividerY).lineTo(doc.page.width - 50, dividerY).stroke();
            

            // --- Members Section ---
            const allMembers = [
                { name: team.name, registrationNumber: team.registrationNumber, qrCode: team.lead.qrCode, isLead: true },
                ...team.teamMembers
            ];

            let currentY = dividerY + 30;
            const memberCardHeight = 85;
            const spacing = 15;

            for (const member of allMembers) {
                if (!member || !member.name || !member.qrCode) continue;

                if (currentY + memberCardHeight > doc.page.height - 50) { // Check for page break
                    doc.addPage();
                    // Redraw background and header on new page
                    doc.rect(0, 0, doc.page.width, doc.page.height).fill(pageBackgroundColor);
                    doc.image(path.join(__dirname, '../public/scorecraft.jpg'), doc.page.width / 2 - 150, doc.page.height / 2 - 150, { width: 300, opacity: 0.05 });
                    doc.image(path.join(__dirname, '../public/hackforge.png'), 50, headerY, { width: 120 });
                    doc.image(path.join(__dirname, '../public/scorecraft.jpg'), doc.page.width - 120, headerY, { width: 70 });
                    currentY = 50;
                }

                // Member Card
                doc.roundedRect(50, currentY, doc.page.width - 100, memberCardHeight, 8).fill(cardBackgroundColor);

                const textX = 70;
                const textY = currentY + 20;

                doc.fillColor(textColor).font('Helvetica-Bold').fontSize(14).text(member.name, textX, textY);
                doc.fillColor(lightTextColor).font('Helvetica').fontSize(9).text(member.registrationNumber, textX, textY + 20);

                if (member.isLead) {
                    doc.rect(textX, textY + 40, 60, 18).fill(primaryColor);
                    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text('TEAM LEAD', textX + 5, textY + 45);
                }

                // QR Code
                const qrImage = Buffer.from(member.qrCode.split(',')[1], 'base64');
                doc.image(qrImage, doc.page.width - 125, currentY + 12.5, { fit: [60, 60] });

                currentY += memberCardHeight + spacing;
            }

            // --- Footer ---
            doc.fontSize(9).fillColor(lightTextColor).text(
                'This document is confidential. Please present it for event check-in and attendance.',
                50, doc.page.height - 50,
                { align: 'center', width: doc.page.width - 100 }
            );

            doc.end();
        } catch (error) {
            console.error("Error generating professional PDF:", error);
            reject(error);
        }
    });
}

module.exports = { generateTeamPDF };
