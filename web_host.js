const express = require("express");
const http = require("http");
const path = require("path");

const PORT = 3024;

// Set up the express app to use EJS and json encoding of URLs for POST
const app = express();
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.json());
app.use(express.urlencoded({extended: true}));

// Event handler logic
const eventsHandler = require("./eventHandler");

const server = http.createServer(app);


// For GET it just sends the index page
app.get("/", async (req, res) => {
    // Empty as we need the root directory
    let argsObj = eventsHandler.createEmptyArguementObject();

    let dirInfo = await eventsHandler.handleDirectoryInfo(argsObj);
    filesPresent = dirInfo.directoryInfoObj.filesPresent;
    dirsPresent = dirInfo.directoryInfoObj.directoriesPresent;

	res.render('index', {filesPresent: filesPresent, dirsPresent: dirsPresent});
});

app.get("/download/open-dir{*any}", (req, res) => {
    let fileName = decodeURIComponent(req.path.slice(10));
    let fPath = path.join(__dirname, fileName);

    res.download(fPath, fileName, (err) => {
        if (err) {
            console.log("Error in sending user file: ", err);
        }
    });
});

app.post("/upload", async (req, res) => {    
    let argsObj = eventsHandler.createEmptyArguementObject();
    argsObj.currentDirectory = req.headers["x-current-directory"];
    argsObj.fileName = req.headers["x-file-name"];
    argsObj.currentChunk = Number(req.headers["x-current-chunk"]);
    argsObj.chunksNeeded = Number(req.headers["x-chunks-needed"]);
    argsObj.readStream = req;

    let rtnObj = await eventsHandler.handleFileUploaded(argsObj);
    
    res.status(rtnObj.status).send(rtnObj.errorMsg);
});

app.post("/createDirectory", async (req, res) => {
    let dir = decodeURIComponent(req.body.directory);
    let name = decodeURIComponent(req.body.name); 

    let argObj = eventsHandler.createEmptyArguementObject();
    argObj.currentDirectory = dir;
    argObj.directoryName = name;

    let rtnObj = await eventsHandler.handleCreateDirectory(argObj);
    
    // If no errors then errorMsg is empty which is what we want
    res.status(rtnObj.status).send(rtnObj.errorMsg);
});

app.post("/getDirectoryInfo", async (req, res) => {
    let dir = decodeURIComponent(req.body.directory);
    let name = decodeURIComponent(req.body.name); 

    let argObj = eventsHandler.createEmptyArguementObject();
    argObj.currentDirectory = dir;
    argObj.directoryName = name;

    let rtnObj = await eventsHandler.handleDirectoryInfo(argObj);

    res.status(rtnObj.status).send(JSON.stringify(rtnObj.directoryInfoObj));
});

app.post("/deleteDirectory", async (req, res) => {
    let dir = decodeURIComponent(req.body.directory);
    let name = decodeURIComponent(req.body.name);

    let argObj = eventsHandler.createEmptyArguementObject();
    argObj.currentDirectory = dir;
    argObj.directoryName = name;

    let rtn = await eventsHandler.handleDeleteDirectory(argObj);

    res.status(rtn.status).send(rtn.errorMsg);
});

app.post("/deleteFile", async (req, res) => {
    let dir = decodeURIComponent(req.body.directory);
    let name = decodeURIComponent(req.body.name);

    let argObj = eventsHandler.createEmptyArguementObject();
    argObj.currentDirectory = dir;
    argObj.fileName = name;

    let rtn = await eventsHandler.handleDeleteFile(argObj);

    res.status(rtn.status).send(rtn.errorMsg);
});

app.post("/cancelUpload", async (req, res) => {
    let dir = decodeURIComponent(req.body.directory);
    let name = decodeURIComponent(req.body.name);

    let argObj = eventsHandler.createEmptyArguementObject();
    argObj.currentDirectory = dir;
    argObj.fileName = name;

    let rtn = await eventsHandler.handleCancelFile(argObj);

    res.status(rtn.status).send(rtn.errorMsg);
});


server.listen(PORT, () => {
    console.log("Server up!");
});



