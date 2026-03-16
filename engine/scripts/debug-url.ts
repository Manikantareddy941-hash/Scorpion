const value = "https://github.com/../../etc/passwd";
const url = new URL(value);
console.log("URL:", value);
console.log("Hostname:", url.hostname);
console.log("Pathname:", url.pathname);
const pathParts = url.pathname.split("/").filter(Boolean);
console.log("PathParts:", pathParts);
console.log("Parts Length:", pathParts.length);
console.log("Contains ..:", pathParts.some(part => part === '..' || part === '.'));
