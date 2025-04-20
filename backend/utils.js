import { users } from "./userData.js"

export const searchUser = (id) => {
    for(let user of users) {
        if(user.id == id) return user;
    }
    return {};
}

export const sendMessange = () => {
    console.log('Message sent!');
    return;
}