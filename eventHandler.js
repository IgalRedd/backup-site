const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HASH_DELIMITER = '{#-#}';
const TIMEOUT = 60; // Timeout in seconds

// TODO: use hashes instead of names
var concurrentWriters = {};

// All answers from the handler will be of this form of object; this is factory to make it
function createEmptyAnswerObject() {
    return {
        status: -1,
        errorMsg: "",
        directoryInfoObj: null
    };
}

// All functions will take in this arguement, so it is up to the calling function to fill it
function createEmptyArguementObject() {
    return {
        currentDirectory: "",      // Name of the current directory
        directoryName: "",         // Name of the directory being made - empty if not /createDirectory
        fileName: "",              // Name of the file being manipulated - empty if not /upload or /download
        chunksNeeded: -1,          // For file uploading: # of chunks needed
        currentChunk: -1,          // For file uploading: which # chunk we are on
        readStream: null           // For file uploading: the actual read stream of data
    };
}

// Is used by inner functions as an object to store what items exist in a directory
function createEmptyDirectoryInfoObject() {
    return {
        filesPresent: [],
        directoriesPresent: [],
        hashesPresent: {}
    };
}

class Timer {
    constructor(argObj) {
        this.argObj = argObj;
        // Creates a timer for TIMEOUt and calls the cancel file object after time out
        this.timer = setTimeout(() => handleCancelFile(this.argObj), TIMEOUT * 1000);
    }

    cancelTimer() {
        if (this.timer != -1) {
            clearTimeout(this.timer);
        }
        
        this.timer = -1;
    }

    resetTimer() {
        this.cancelTimer();
        this.timer = setTimeout(() => handleCancelFile(this.argObj), TIMEOUT * 1000);
    }
}



// Gathers all the files and directories in a given directory
async function gatherDirectoryInfo(dirPath) {
    let dirInfoObj = createEmptyDirectoryInfoObject();

    // Uses directoryName of the arguements as the jumping point -> so current directory to directory name in said directory
    let itemsPresent = await fs.promises.readdir(dirPath, {withFileTypes: true});
    // Filter to files only, get the names only and remove the hashDB.txt file as it doesn't count
    dirInfoObj.filesPresent = itemsPresent.filter(e => e.isFile()).map(e => e.name).filter(e => e != "hashDB.txt");
    // Filter to directories only, get the names
    dirInfoObj.directoriesPresent = itemsPresent.filter(e => e.isDirectory()).map(e => e.name);

    return dirInfoObj;
}

// Gathers the hash table in a directory. It is HASH - NAME (of file)
async function gatherDirectoryHashes(dirPath) {
    let rtn = {};

    // Create the hash mapping of HASH - NAME but using the HASH_DELIMITER
    let lines = (await fs.promises.readFile(path.join(dirPath, "hashDB.txt"), "utf-8")).split("\n");

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line === "") { continue; }

        let hashedLine = line.split(HASH_DELIMITER);
        rtn[hashedLine[0]] = hashedLine[1];
    }
    return rtn;
}

// Given file name, the hash and the path saves it to the file
async function saveNewHash(dirPath, newHash, name) {
    let newLine = `${newHash}${HASH_DELIMITER}${name}\n`;
    
    await fs.promises.appendFile(path.join(dirPath, "hashDB.txt"), newLine, "utf-8");
}

// Given the name and the path removes the given pairing from the file
async function removeHash(dirPath, name) {
    // TODO: lock the file from editing while doing this
    let lines = (await fs.promises.readFile(dirPath, "utf-8")).split("\n");

    // Find the hash and remove it from list
    for (let i = 0; i < lines.length - 1; i++) {
        let splitLine = lines[i].trim().split(HASH_DELIMITER);

        if (splitLine[1] == name) {
            lines.splice(i, 1);
            break;
        }
    }
    
    await fs.promises.writeFile(dirPath, lines.join("\n"), "utf-8");
}



async function handleCreateDirectory(argObj) {
    let rtn = createEmptyAnswerObject();
    let currentDirectory = argObj.currentDirectory;
    let directoryName = argObj.directoryName;

    // Get all items in the directory
    let items = await fs.promises.readdir(path.join(__dirname, "open-dir", currentDirectory), {withFileTypes: true});
    // Keep directory names only
    let otherDirs = items.filter(e => e.isDirectory()).map(e => e.name);

    // If name is already there then tell user we can't make directory
    if (otherDirs.indexOf(directoryName) != -1) {
        rtn.status = 400;
        rtn.errorMsg = "Name for directory is already taken, please choose another.";
        return rtn;
    }

    // Creates the directory
    await fs.promises.mkdir(path.join(__dirname, "open-dir", currentDirectory, directoryName));

    // Create the hashDB file
    fs.open(path.join(__dirname, "open-dir", currentDirectory, directoryName, "hashDB.txt"), "w", (err, fd) => {
        if (err) {
            console.log("Error creating hashDB file: ", err);
        }

        fs.close(fd, (err) => {
            if (err) {
                console.log("Error closing hashDB file: ", err);
            }
        });
    });

    rtn.status = 200;
    return rtn;
}

async function handleDirectoryInfo(argObj) {
    let rtn = createEmptyAnswerObject();
    let dirInfoObj = await gatherDirectoryInfo(path.join(__dirname, "open-dir", argObj.currentDirectory, argObj.directoryName));

    rtn.directoryInfoObj = dirInfoObj;
    rtn.status = 200;
    return rtn;
}

async function handleDeleteDirectory(argObj) {
    let rtn = createEmptyAnswerObject();
    let dirPath = path.join(__dirname, "open-dir", argObj.currentDirectory, argObj.directoryName);
    let dirInfoObj = await gatherDirectoryInfo(dirPath);
    
    // Can't delete directory if it isn't empty
    if (dirInfoObj.directoriesPresent.length != 0 || dirInfoObj.filesPresent.length != 0) {
        rtn.status = 400;
        rtn.errorMsg = "Directory isn't empty.";

        return rtn;
    }

    // Deletes the hash file before deleting the directory
    try {
        await fs.promises.rm(path.join(dirPath, "hashDB.txt"));
        await fs.promises.rmdir(dirPath);

        rtn.status = 200;
    } catch (err) {
        console.log(`Error encountered in deleting directory: ${dirPath}. The error is: ${err}`); // TODO: proper handling for the html site

        rtn.status = 400;
    }

    return rtn;
}

async function handleFileUploaded(argObj) {
    let rtn = createEmptyAnswerObject();
    let name = argObj.fileName;
    let dirPath = path.join(__dirname, "open-dir", argObj.currentDirectory);
    let writer = concurrentWriters[name];

    // If this is the first time we are seeing this check uniqueness of name
    if (writer == undefined) {
        // A truly new file so set it up
        if (argObj.currentChunk == 0) {
            let dirInfoObj = await gatherDirectoryInfo(dirPath)

            // Check uniqueness
            if (dirInfoObj.filesPresent.indexOf(name) != -1) {
                rtn.status = 400;
                rtn.errorMsg = "Name is already present in the directory, please rename the file.";

                return rtn;
            }

            // Setup and store the writer object
            writer = [fs.createWriteStream(path.join(dirPath, name)), crypto.createHash("sha1"), new Timer(argObj)];
            concurrentWriters[name] = writer;
        } else {
            // A file that was cancelled and we received an extra chunk
            rtn.status = 421;
            rtn.errorMsg = "Cancelled";

            return rtn;
        }
    }

    let dataPromise = new Promise((resolve, reject) => {
        argObj.readStream.on("data", (chunk) => {
            writer[0].write(chunk);
            writer[1].update(chunk);
            writer[2].resetTimer();
            resolve();
        });
    });

    let endPromise = new Promise((resolve, reject) => {
        argObj.readStream.on("end", () => {
            resolve();
        });
    });

    await dataPromise;

    if (argObj.currentChunk + 1 == argObj.chunksNeeded) {
        await endPromise;
        writer[2].cancelTimer();
        writer[0].end();
        let digestedHash = writer[1].digest("hex");
        let knownHashes = await gatherDirectoryHashes(dirPath);

        // Check hash is unique
        if (knownHashes[digestedHash] != undefined) {
            rtn.status = 400;
            rtn.errorMsg = "This isn't a unique hash, so this file is a duplicate.";

            // Remove the file
            await fs.promises.unlink(path.join(dirPath, name));
            delete concurrentWriters[name];

            return rtn;
        }

        await saveNewHash(dirPath, digestedHash, name);

        delete concurrentWriters[name];
    }

    rtn.status = 200;
    return rtn;
}

async function handleDeleteFile(argObj) {
    let rtn = createEmptyAnswerObject();
    let dirPath = path.join(__dirname, "open-dir", argObj.currentDirectory);

    // Delete the hash and remove the file
    // TODO: these can run concurrently, also handle errors
    await removeHash(path.join(dirPath, "hashDB.txt"), argObj.fileName);
    await fs.promises.unlink(path.join(dirPath, argObj.fileName));

    rtn.status = 200;
    
    return rtn;
}

async function handleCancelFile(argObj) {
    let rtn = createEmptyAnswerObject();
    let name = argObj.fileName;
    let dirPath = path.join(__dirname, "open-dir", argObj.currentDirectory);
    let writer = concurrentWriters[name];

    // Remove the ability to reference it, so we don't get a problem
    // if the computer switches functions half way through our finalizing
    delete concurrentWriters[name];

    console.log(concurrentWriters);

    // Just digest what we had but don't store it
    writer[1].digest("hex");

    // We don't need the file anymore
    writer[0].destroy();
    await fs.promises.unlink(path.join(dirPath, name));

    rtn.status = 200;
    return rtn;
}

module.exports = {
    createEmptyArguementObject,
    handleCreateDirectory,
    handleDirectoryInfo,
    handleFileUploaded,
    handleDeleteDirectory,
    handleDeleteFile,
    handleCancelFile
}