const fs = require('fs');
const path = './src/components/AuthPage.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove rememberMe state
content = content.replace(/const \[rememberMe, setRememberMe\] = useState\(true\);/g, '');

// Force browserLocalPersistence
content = content.replace(/rememberMe \? browserLocalPersistence : browserSessionPersistence/g, 'browserLocalPersistence');

// Remove the UI block
const uiBlockRegex = /\{isLogin && \(\s*<div className="mt-4">[\s\S]*?<\/div>\s*\)\}/;
content = content.replace(uiBlockRegex, '{isLogin && (<div className="mt-4">{/* Remember me is now always on by default */}</div>)}');

fs.writeFileSync(path, content);
console.log('Successfully updated AuthPage.tsx');
