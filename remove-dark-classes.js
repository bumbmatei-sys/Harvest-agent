const fs = require('fs');
const path = require('path');

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // Regex to match "dark:" followed by Tailwind class characters
      // e.g. dark:bg-gray-800, dark:hover:bg-gray-800, dark:text-white
      // Also handle dark:bg-[#1a1d27]
      // Also handle dark:border-gray-800/50
      const newContent = content.replace(/dark:[a-zA-Z0-9_/-]+(?:\[[^\]]+\])?(?:\/[0-9]+)?/g, '');
      if (content !== newContent) {
        // Clean up double spaces that might be left behind
        const cleanedContent = newContent.replace(/  +/g, ' ');
        fs.writeFileSync(fullPath, cleanedContent, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDirectory('./src');
