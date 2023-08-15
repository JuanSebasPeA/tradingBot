const colors = {
    green: '\x1b[32m%s\x1b[0m',
    red: '\x1b[31m%s\x1b[0m',
    gray: '\x1b[37m%s\x1b[0m',
}

// this function will log a message in the color passed as argument
const logColor = (color, message) => {
    console.log(color, message)
}

// this function will log a message in green
const log = (message) => {
    console.log(message)
}

module.exports = {
    logColor,
    log,
    colors
}