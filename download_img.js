const https = require('https');
const fs = require('fs');

const file = fs.createWriteStream("Stitch_Screens/Minimalist_Premium_SecOps_Dashboard_V1.png");
const request = https.get("https://lh3.googleusercontent.com/aida/AP1WRLvbk8uwcRURj15L4LD_iZvQL_lqn1-V8x-hV0WXoHMq8ZbeS0EwTCEQbx7-GEGfsr9sR0IZ8co5omNdBQOIkTR9HpE70FYgmUsD-L0-HQN9pipq674duWEsY5I0Sr07G04_pTCLGo6Q1DDfDM84VMcvvCqzaGBJ2HJ77Llg6h1aNElirLBI-MoptAnslIImMPS5b31DGbwwVxVNyh8C26Lx25oyYX4dc47_FvNRNfFsC7gFTqvwnb5JVQ", function(response) {
  response.pipe(file);
  file.on('finish', function() {
    file.close();  
    console.log("Download complete!");
  });
});
