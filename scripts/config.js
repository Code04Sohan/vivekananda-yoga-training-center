// ==========================================
// VIVEKANANDA YOGA ACADEMY - CONFIGURATION
// ==========================================
// Edit this file to add, remove, or change content on the website.
// It will automatically update the website without touching HTML.

/* 
============================================================
HOW TO USE GOOGLE DRIVE LINKS FOR IMAGES
============================================================
Do NOT use standard Google Drive sharing links (like https://drive.google.com/file/d/12345/view)
They will not work in img tags.

Instead, change the link to this exact format:
https://drive.google.com/uc?export=view&id=YOUR_FILE_ID

Example:
If your share link is: https://drive.google.com/file/d/1BxxA_Example_ID_XYZ/view?usp=sharing
Your image URL here should be: https://drive.google.com/uc?export=view&id=1BxxA_Example_ID_XYZ

Make sure the file in Google Drive is set to "Anyone with the link can view"!
============================================================
*/

const siteData = {
    // --- EVENTS & ANNOUNCEMENTS ---
    events: [
        {
            month: "NOV",
            date: "01",
            type: "Event",
            title: "বার্ষিক সাংস্কৃতিক প্রতিযোগিতা ও উৎসব ২০২৬",
            description: "পরিচালনায় :- বিবেকানন্দ যোগ ট্রেনিং সেন্টার",
            location: "অভিনন্দন উৎসব ভবন , সিদ্ধা বাজার",
            color: "secondary",
            image: "resources/Event1.jpeg",
            icon: "self_improvement",
            link: "https://www.soumenyoga.in/register/"
        }
    ],

    // --- TRAINING CENTERS ---
    centers: [
        { title: "Advance Yoga Class", location: "Mecheda", district: "Purba Medinipur", color: "primary" },
        { title: "PAYAG PUNARMILAN SEVA SANGHA", location: "DEULIA", district: "Purba Medinipur", color: "secondary" },
        { title: "DAKSHIN MECHOGRAM YOG PRASIKSHAN KENDRA", location: "MECHOGRAM", district: "Purba Medinipur", color: "tertiary" },
        { title: "CHAKKASHI YOG TRAINING CENTRE", location: "(ASHARI) PASCHIM MEDINIPUR", district: "Paschim Medinipur", color: "primary" },
        { title: "BARHBAHALA PASCHIMPARA YOG PRASIKSHAN KENDRA", location: "MECHEDA", district: "Purba Medinipur", color: "secondary" },
        { title: "MADHYAHINGLI TARUN SANGHA BYAMAGAR", location: "MAHISADAL", district: "Purba Medinipur", color: "tertiary" },
        { title: "MESHARAH YOG PRASIKSHAN KENDRA (K.T.P.P.)", location: "(K.T.P.P.)MESHARAH", district: "Purba Medinipur", color: "primary" },
        { title: "JAMALCHAK YOG TRAINING CENTRE", location: "(ASHARI) PASCHIM MEDINIPUR", district: "Paschim Medinipur", color: "secondary" },
        { title: "HAZRA YOG TRAINING CENTRE", location: "(GOURA) PASCHIM MEDINIPUR", district: "Paschim Medinipur", color: "tertiary" },
        { title: "JORAPUKUR YOG PRASIKSHAN KENDRA", location: "JORAPUKUR", district: "Purba Medinipur", color: "primary" },
        { title: "KHANCHI AZAD HIND SANGHA", location: "BANAKPOTA (KHANCHI)", district: "Purba Medinipur", color: "secondary" },
        { title: "GURHCHAKLI BISHNUBARH SHIBMANDIR YOG PRASIKSHAN KENDRA", location: "GURHCHAKLI", district: "Purba Medinipur", color: "tertiary" },
        { title: "DHULIARA YOG PRASIKSHAN KENDRA", location: "DHULIARA", district: "Purba Medinipur", color: "primary" },
        { title: "PASHRAH AMRA KAJAN SANGHA", location: "PASHRAH (KHARUI)", district: "Purba Medinipur", color: "secondary" },
        { title: "JIAKHALI YOG PRASIKSHAN KENDRA", location: "JIAKHALI", district: "Purba Medinipur", color: "tertiary" },
        { title: "MAHISADAL RATHTALA", location: "MAHISADAL", district: "Purba Medinipur", color: "primary" },
        { title: "PARBATIPUR SASTHITALA ANGANWARI YOG PRASIKSHAN KENDRA", location: "(SONAMUI) PASCHIM MEDINIPUR", district: "Paschim Medinipur", color: "secondary" },
        { title: "UTTAR MECHOGRAM YOGASANA PRASIKSHAN KENDRA", location: "MECHOGRAM", district: "Purba Medinipur", color: "tertiary" },
        { title: "CHAPDA YOG PRASIKSHAN KENDRA", location: "CHAPDA", district: "Purba Medinipur", color: "primary" },
        { title: "PANSKURA YOG PRASIKSHAN KENDRA", location: "PANSKURA STATION", district: "Purba Medinipur", color: "secondary" },
        { title: "SONAPETYA YOG PRASIKSHAN KENDRA", location: "SONAPETYA TOLL PLAZA", district: "Purba Medinipur", color: "tertiary" }
    ],

    // --- GALLERY IMAGES ---
    gallery: [
        { src: "resources/gallery1.jpg", alt: "Yoga Gallery Image 1" },
        { src: "resources/gallery10.jpg", alt: "Yoga Gallery Image 2" },
        { src: "resources/gallery11.jpg", alt: "Yoga Gallery Image 3" },
        { src: "resources/gallery12.jpg", alt: "Yoga Gallery Image 4" },
        { src: "resources/gallery13.jpg", alt: "Yoga Gallery Image 5" },
        { src: "resources/gallery14.jpg", alt: "Yoga Gallery Image 6" },
        { src: "resources/gallery15.jpg", alt: "Yoga Gallery Image 7" },
        { src: "resources/gallery16.jpg", alt: "Yoga Gallery Image 8" },
        { src: "resources/gallery17.jpg", alt: "Yoga Gallery Image 9" },
        { src: "resources/gallery18.jpg", alt: "Yoga Gallery Image 10" },
        { src: "resources/gallery19.jpg", alt: "Yoga Gallery Image 11" },
        { src: "resources/gallery2.jpeg", alt: "Yoga Gallery Image 12" },
        { src: "resources/gallery20.jpg", alt: "Yoga Gallery Image 13" },
        { src: "resources/gallery21.jpg", alt: "Yoga Gallery Image 14" },
        { src: "resources/gallery22.jpeg", alt: "Yoga Gallery Image 15" },
        { src: "resources/gallery23.jpg", alt: "Yoga Gallery Image 16" },
        { src: "resources/gallery24.jpg", alt: "Yoga Gallery Image 17" },
        { src: "resources/gallery25.jpg", alt: "Yoga Gallery Image 18" },
        { src: "resources/gallery26.jpg", alt: "Yoga Gallery Image 19" },
        { src: "resources/gallery27.jpeg", alt: "Yoga Gallery Image 20" },
        { src: "resources/gallery28.jpg", alt: "Yoga Gallery Image 21" },
        { src: "resources/gallery3.jpeg", alt: "Yoga Gallery Image 22" },
        { src: "resources/gallery4.jpeg", alt: "Yoga Gallery Image 23" },
        { src: "resources/gallery5.jpg", alt: "Yoga Gallery Image 24" },
        { src: "resources/gallery6.jpeg", alt: "Yoga Gallery Image 25" },
        { src: "resources/gallery7.jpeg", alt: "Yoga Gallery Image 26" },
        { src: "resources/gallery8.jpg", alt: "Yoga Gallery Image 27" },
        { src: "resources/gallery9.jpg", alt: "Yoga Gallery Image 28" }
    ]
};
