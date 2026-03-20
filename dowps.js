const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const connectDB = require('./db');
const Domain = require('./module/Domain');

const generatePDF = async () => {
    try {
        console.log("Connecting to database...");
        await connectDB();

        console.log("Fetching domains from database...");
        const domains = await Domain.find().sort({ set: 1, name: 1 });

        if (!domains || domains.length === 0) {
            console.log("No problem statements found in the database.");
            process.exit(0);
        }

        console.log(`Found ${domains.length} domains. Generating PDF...`);
        const doc = new PDFDocument({ margin: 50 });
        const pdfPath = path.join(__dirname, 'problem_statements.pdf');
        const stream = fs.createWriteStream(pdfPath);

        doc.pipe(stream);

        // Title Page
        doc.fontSize(24).font('Helvetica-Bold').text('Hackathon Problem Statements', { align: 'center' });
        doc.moveDown(2);

        let currentSet = "";
        let isFirstPage = true;

        domains.forEach((domain, index) => {
            if (domain.set && domain.set !== currentSet) {
                currentSet = domain.set;
                if (!isFirstPage) {
                    doc.addPage();
                }
                isFirstPage = false;
                doc.fontSize(20).font('Helvetica-Bold').text(`Set: ${currentSet}`, { underline: true });
                doc.moveDown(1);
            } else if (!isFirstPage && doc.y > 600) {
                // simple pagination if near the bottom of the page
                doc.addPage();
            }

            doc.fontSize(16).font('Helvetica-Bold').text(`${index + 1}. Domain: ${domain.name} (ID: ${domain.id})`);
            doc.fontSize(12).font('Helvetica').text(`Slots: ${domain.slots}`);

            if (domain.features && domain.features.length > 0) {
                doc.font('Helvetica-Oblique').text(`Features: ${domain.features.join(', ')}`);
            }

            doc.moveDown(0.5);
            doc.fontSize(14).font('Helvetica-Bold').text('Problem Statement:');
            doc.moveDown(0.2);
            doc.fontSize(12).font('Helvetica').text(domain.problemStatement || "N/A", { align: 'justify' });
            doc.moveDown(2);

            // Draw a line separator between domains
            doc.moveTo(50, doc.y - 10).lineTo(550, doc.y - 10).stroke();
            doc.moveDown(1);
        });

        doc.end();

        stream.on('finish', () => {
            console.log(`PDF generated successfully at ${pdfPath}`);
            process.exit(0);
        });

    } catch (error) {
        console.error("Error generating PDF:", error);
        process.exit(1);
    }
};

generatePDF();
